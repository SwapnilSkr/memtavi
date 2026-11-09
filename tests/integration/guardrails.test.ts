import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createLogger } from "@memtavi/shared/logging";
import { createFakeStore } from "@memtavi/storage/fake";
import { Pool } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";
import { issueKey } from "../../apps/api/src/lib/keys";

interface ErrorBody {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  body: { message: string; error: string; statusCode: number };
}

interface LogRecord {
  level: string;
  time: string;
  msg: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  [key: string]: unknown;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");

describe.skipIf(!ownerUrl || !appUrl)("rate limiting and request logs", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const slug = `guard-${crypto.randomUUID()}`;
  const subject = crypto.randomUUID();
  const clock = new Date("2026-11-07T00:00:30.000Z");
  const lines: string[] = [];
  const logger = createLogger({
    level: "debug",
    stream: {
      write(line: string) {
        lines.push(line);
      },
    },
  });
  let tenantId: string;
  let actorId: string;
  let ownerKey: string;
  let db: typeof import("@memtavi/db/client");
  let limitedApp: ReturnType<typeof createApp>;
  let loggedApp: ReturnType<typeof createApp>;
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  function request(
    app: ReturnType<typeof createApp>,
    path: string,
    options: {
      key?: string | undefined;
      subject?: string | null;
      method?: string;
      body?: unknown;
      id?: string;
    } = {},
  ) {
    const headers = new Headers();
    if (options.key !== undefined) headers.set("x-api-key", options.key);
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subject);
    if (options.id) headers.set("x-request-id", options.id);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  async function mintKey(name: string): Promise<string> {
    const key = issueKey();
    await owner.query(
      `INSERT INTO api_keys (tenant_id, created_by, name, prefix, key_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'developer')`,
      [tenantId, actorId, name, key.prefix, key.hash],
    );
    return key.key;
  }

  function parsed(): LogRecord[] {
    return lines.map((line) => JSON.parse(line) as LogRecord);
  }

  async function waitFor(predicate: (records: LogRecord[]) => boolean): Promise<LogRecord[]> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const records = parsed();
      if (predicate(records)) return records;
      await Bun.sleep(10);
    }
    throw new Error("Timed out waiting for request log lines");
  }

  function recordFor(records: LogRecord[], id: string): LogRecord {
    const found = records.find((record) => record.requestId === id);
    if (!found) throw new Error(`Missing log record ${id}`);
    return found;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Guardrails fixtures require a disposable memtavi_test database");
    }
    fixturesAuthorized = true;
    process.env.APP_DATABASE_URL = appUrl;
    db = await import("@memtavi/db/client");
    ownerKey = await bootstrap(owner, "Guardrails", slug);
    const tenant = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [
      slug,
    ]);
    tenantId = tenant.rows[0]?.id ?? "";
    const actor = await owner.query<{ created_by: string }>(
      "SELECT created_by FROM api_keys WHERE tenant_id = $1",
      [tenantId],
    );
    actorId = actor.rows[0]?.created_by ?? "";
    limitedApp = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => clock,
      rateLimitPerMinute: 2,
    });
    loggedApp = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => fixedNow,
      logger,
    });
  });

  afterAll(async () => {
    if (fixturesAuthorized) {
      const actors = await owner.query<{ created_by: string }>(
        "SELECT created_by FROM api_keys WHERE tenant_id = $1",
        [tenantId],
      );
      await owner.query("DELETE FROM tenants WHERE slug = $1", [slug]);
      await owner.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [...new Set(actors.rows.map((row) => row.created_by))],
      ]);
    }
    await owner.end();
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  });

  test("two calls pass, the third is 429 with Retry-After, and another key is unaffected", async () => {
    const keyA = await mintKey("limit-a");
    const keyB = await mintKey("limit-b");
    const windowStart = Math.floor(clock.getTime() / 60_000) * 60_000;
    const reset = String(Math.floor((windowStart + 60_000) / 1000));

    const first = await request(limitedApp, "/v1/brains", { key: keyA });
    expect(first.status).toBe(200);
    expect(first.headers.get("RateLimit-Limit")).toBe("2");
    expect(first.headers.get("RateLimit-Remaining")).toBe("1");
    expect(first.headers.get("RateLimit-Reset")).toBe(reset);

    const second = await request(limitedApp, "/v1/brains", { key: keyA });
    expect(second.status).toBe(200);
    expect(second.headers.get("RateLimit-Remaining")).toBe("0");

    const third = await request(limitedApp, "/v1/brains", { key: keyA });
    expect(third.status).toBe(429);
    const retryAfter = third.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await third.json()) as ErrorBody;
    expect(body.statusCode).toBe(429);
    expect(body.path).toBe("/v1/brains");
    expect(body.body).toEqual({
      message: "Rate limit exceeded",
      error: "RateLimitError",
      statusCode: 429,
    });

    const other = await request(limitedApp, "/v1/brains", { key: keyB });
    expect(other.status).toBe(200);
    expect(other.headers.get("RateLimit-Remaining")).toBe("1");
  });

  test("the window resets when the injected clock advances a minute", async () => {
    const key = await mintKey("limit-reset");
    const previous = clock.getTime();
    clock.setTime(new Date("2026-11-07T00:05:00.000Z").getTime());
    try {
      expect((await request(limitedApp, "/v1/brains", { key })).status).toBe(200);
      expect((await request(limitedApp, "/v1/brains", { key })).status).toBe(200);
      expect((await request(limitedApp, "/v1/brains", { key })).status).toBe(429);

      clock.setTime(clock.getTime() + 60_000);
      const reset = await request(limitedApp, "/v1/brains", { key });
      expect(reset.status).toBe(200);
      expect(reset.headers.get("RateLimit-Remaining")).toBe("1");
    } finally {
      clock.setTime(previous);
    }
  });

  test("request logs carry ids, route, status and duration without keys, queries or bodies", async () => {
    const success = await request(loggedApp, "/v1/brains?limit=1&offset=0&canary=QUERY_CANARY", {
      key: ownerKey,
      id: "log-success",
    });
    expect(success.status).toBe(200);
    const denied = await request(loggedApp, "/v1/brains?canary=QUERY_CANARY", {
      key: "mtv_live_invalid_key",
      id: "log-denied",
    });
    expect(denied.status).toBe(401);
    const created = await request(loggedApp, "/v1/brains", {
      key: ownerKey,
      method: "POST",
      id: "log-created",
      body: { name: "Body BODY_CANARY", slug: `log-${crypto.randomUUID()}` },
    });
    expect(created.status).toBe(201);

    const records = await waitFor((all) =>
      ["log-success", "log-denied", "log-created"].every((id) =>
        all.some((record) => record.requestId === id),
      ),
    );
    const successRecord = recordFor(records, "log-success");
    expect(successRecord).toMatchObject({
      level: "info",
      msg: "request",
      method: "GET",
      path: "/v1/brains",
      status: 200,
    });
    expect(typeof successRecord.durationMs).toBe("number");
    expect(typeof successRecord.time).toBe("string");
    expect(recordFor(records, "log-denied")).toMatchObject({
      msg: "request",
      method: "GET",
      path: "/v1/brains",
      status: 401,
    });
    expect(recordFor(records, "log-created")).toMatchObject({
      msg: "request",
      method: "POST",
      path: "/v1/brains",
      status: 201,
    });

    for (const record of records) {
      expect(Object.keys(record)).not.toContain("body");
      expect(Object.keys(record)).not.toContain("headers");
      expect(Object.keys(record)).not.toContain("query");
      expect(Object.keys(record)).not.toContain("x-api-key");
      expect(Object.keys(record)).not.toContain("x-subject-id");
    }
    const logged = lines.join("\n");
    expect(logged).not.toContain("x-api-key");
    expect(logged).not.toContain("mtv_live_");
    expect(logged).not.toContain("QUERY_CANARY");
    expect(logged).not.toContain("BODY_CANARY");
  });
});
