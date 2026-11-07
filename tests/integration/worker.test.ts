import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createApp } from "@memtavi/api/app";
import { fetchDocument } from "@memtavi/fetch";
import { createFakeStore } from "@memtavi/storage/fake";
import { sourceKey } from "@memtavi/storage/keys";
import { createWorker, type WorkerConfig } from "@memtavi/worker";
import { ingestCapture } from "@memtavi/worker/ingest";
import { JobError } from "@memtavi/worker/types";
import { Pool } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface SourceBody {
  id: string;
  contentPreview: string;
  contentUrl: string | null;
  contentHash: string;
  originalBytes: number;
  metadata: Record<string, unknown>;
  status: string;
}

interface BrainBody {
  id: string;
}

interface JobRow {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  lease_until: Date | null;
  available_at: Date;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe.skipIf(!ownerUrl || !appUrl)("worker job engine and capture.ingest", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const store = createFakeStore();
  const slug = `worker-${crypto.randomUUID()}`;
  const subjectId = crypto.randomUUID();
  const previousAppUrl = process.env.APP_DATABASE_URL;
  let tenantId = "";
  let brainId = "";
  let apiKey = "";
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let fixturesAuthorized = false;

  function request(path: string, options: { method?: string; body?: unknown } = {}) {
    const headers = new Headers();
    headers.set("x-api-key", apiKey);
    headers.set("x-subject-id", subjectId);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  async function capture(body: unknown): Promise<{ status: number; body: SourceBody }> {
    const response = await request(`/v1/brains/${brainId}/captures`, { method: "POST", body });
    return { status: response.status, body: (await response.json()) as SourceBody };
  }

  function worker(overrides: Partial<WorkerConfig> = {}) {
    return createWorker({
      withTenant: db.withTenant,
      tenantIds: [tenantId],
      store,
      handlers: { "capture.ingest": async () => undefined },
      random: () => 0,
      log: () => undefined,
      ...overrides,
    });
  }

  async function queueJob(
    options: {
      type?: string;
      payload?: Record<string, unknown>;
      maxAttempts?: number;
      status?: string;
      attempts?: number;
      leaseSeconds?: number | null;
      availableSeconds?: number;
    } = {},
  ): Promise<string> {
    const {
      type = "capture.ingest",
      payload = {},
      maxAttempts = 5,
      status = "pending",
      attempts = 0,
      leaseSeconds = null,
      availableSeconds = 0,
    } = options;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO jobs
         (tenant_id, brain_id, type, payload, idempotency_key, max_attempts, status, attempts,
          available_at, lease_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         now() + make_interval(secs => $9),
         CASE WHEN $10::int IS NULL THEN NULL ELSE now() + make_interval(secs => $10::int) END)
       RETURNING id`,
      [
        tenantId,
        brainId,
        type,
        JSON.stringify(payload),
        `test:${crypto.randomUUID()}`,
        maxAttempts,
        status,
        attempts,
        availableSeconds,
        leaseSeconds,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Job insert returned no row");
    return id;
  }

  async function jobRow(id: string): Promise<JobRow> {
    const result = await owner.query<JobRow>(
      `SELECT id, status, attempts, max_attempts, last_error, lease_until, available_at
       FROM jobs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Job row missing");
    return row;
  }

  async function sourceRow(id: string) {
    const result = await owner.query<{
      content: string;
      content_hash: string;
      body_ref: string | null;
      body_bytes: number;
      original_bytes: number;
      metadata: Record<string, unknown>;
      status: string;
      last_error: string | null;
    }>(
      `SELECT content, content_hash, body_ref, body_bytes, original_bytes, metadata, status,
         last_error
       FROM ingest_sources WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Source row missing");
    return row;
  }

  async function compileJobs() {
    const result = await owner.query<{
      type: string;
      payload: Record<string, unknown>;
      idempotency_key: string;
      status: string;
    }>(
      `SELECT type, payload, idempotency_key, status FROM jobs
       WHERE tenant_id = $1 AND type = 'capture.compile'`,
      [tenantId],
    );
    return result.rows;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Worker fixtures require a disposable memtavi_test database");
    }
    const appDatabase = await application.query<{
      name: string;
      role: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_database() AS name, current_user AS role, rolsuper, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`,
    );
    expect(appDatabase.rows[0]).toEqual({
      name: database.rows[0]?.name ?? "",
      role: "memtavi_app",
      rolsuper: false,
      rolbypassrls: false,
    });
    fixturesAuthorized = true;
    process.env.APP_DATABASE_URL = appUrl;
    db = await import("@memtavi/db/client");
    app = createApp({ ownerPool: owner, withTenant: db.withTenant, store, now: () => fixedNow });
    apiKey = await bootstrap(owner, "Worker Engine", slug);
    const tenant = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [
      slug,
    ]);
    tenantId = tenant.rows[0]?.id ?? "";
    const brain = await request("/v1/brains", {
      method: "POST",
      body: { name: "Worker Brain", slug: `brain-${crypto.randomUUID()}` },
    });
    expect(brain.status).toBe(201);
    brainId = ((await brain.json()) as BrainBody).id;
  });

  beforeEach(async () => {
    await owner.query("DELETE FROM jobs WHERE tenant_id = $1", [tenantId]);
  });

  afterAll(async () => {
    if (fixturesAuthorized) {
      const actors = await owner.query<{ created_by: string }>(
        `SELECT k.created_by FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
         WHERE t.slug = $1`,
        [slug],
      );
      await owner.query("DELETE FROM tenants WHERE slug = $1", [slug]);
      await owner.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [...new Set(actors.rows.map((row) => row.created_by))],
      ]);
    }
    await Promise.all([owner.end(), application.end()]);
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  });

  test("two concurrent claimers never take the same job", async () => {
    await queueJob();
    const instance = worker();
    const claims = await Promise.all([instance.runOnce(), instance.runOnce()]);
    expect(claims.sort()).toEqual([false, true]);
    const rows = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM jobs WHERE tenant_id = $1",
      [tenantId],
    );
    expect(rows.rows[0]?.total).toBe(1);
    const jobs = await owner.query<JobRow>(
      "SELECT id, status, attempts, max_attempts, last_error, lease_until, available_at FROM jobs WHERE tenant_id = $1",
      [tenantId],
    );
    expect(jobs.rows[0]?.status).toBe("completed");
    expect(jobs.rows[0]?.attempts).toBe(1);
    expect(jobs.rows[0]?.lease_until).toBeNull();
  });

  test("an expired lease is claimable again and increments attempts", async () => {
    const id = await queueJob({ status: "running", attempts: 1, leaseSeconds: -60 });
    expect(await worker().runOnce()).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("completed");
    expect(row.attempts).toBe(2);
  });

  test("a transient failure backs off exponentially with jitter", async () => {
    const id = await queueJob({ maxAttempts: 5 });
    const instance = worker({
      handlers: {
        "capture.ingest": async () => {
          throw new JobError("transient", "Fetch failed");
        },
      },
    });
    expect(await instance.runOnce()).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("Fetch failed");
    expect(row.lease_until).toBeNull();
    const delay = await owner.query<{ seconds: number }>(
      "SELECT extract(epoch FROM available_at - now())::float8 AS seconds FROM jobs WHERE id = $1",
      [id],
    );
    expect(delay.rows[0]?.seconds ?? 0).toBeGreaterThan(1);
    expect(delay.rows[0]?.seconds ?? 0).toBeLessThanOrEqual(3);
  });

  test("a permanent failure moves the job to dead immediately", async () => {
    const id = await queueJob({ maxAttempts: 5 });
    const instance = worker({
      handlers: {
        "capture.ingest": async () => {
          throw new JobError("permanent", "Source not found");
        },
      },
    });
    expect(await instance.runOnce()).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("Source not found");
    expect(row.lease_until).toBeNull();
  });

  test("a transient failure on the last attempt moves the job to dead", async () => {
    const id = await queueJob({ maxAttempts: 1 });
    const instance = worker({
      handlers: {
        "capture.ingest": async () => {
          throw new JobError("transient", "Fetch failed");
        },
      },
    });
    expect(await instance.runOnce()).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("Fetch failed");
  });

  test("an unregistered job type is never claimed", async () => {
    await queueJob({ type: "capture.compile" });
    expect(await worker().runOnce()).toBe(false);
    const rows = await owner.query<{ status: string }>(
      "SELECT status FROM jobs WHERE tenant_id = $1 AND type = 'capture.compile'",
      [tenantId],
    );
    expect(rows.rows[0]?.status).toBe("pending");
  });

  test("capture.ingest stores fetched text and enqueues exactly one compile", async () => {
    const created = await capture({
      kind: "url",
      fetchUrl: "https://example.com/article",
      originRef: `url-${crypto.randomUUID()}`,
    });
    expect(created.status).toBe(201);
    const sourceId = created.body.id;
    let fetches = 0;
    const instance = worker({
      handlers: { "capture.ingest": ingestCapture },
      fetchDocument: (url) => {
        fetches += 1;
        return fetchDocument(url, {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          fetchImpl: async () =>
            new Response("fetched body", {
              status: 200,
              headers: { "content-type": "text/plain; charset=utf-8" },
            }),
        });
      },
    });

    expect(await instance.runOnce()).toBe(true);
    expect(fetches).toBe(1);

    const source = await sourceRow(sourceId);
    expect(source.content).toBe("fetched body");
    expect(source.content_hash).toBe(sha256("fetched body"));
    expect(source.original_bytes).toBe(Buffer.byteLength("fetched body", "utf8"));
    expect(source.body_bytes).toBe(Buffer.byteLength("fetched body", "utf8"));
    const key = sourceKey({ tenantId, sourceId, body: "fetched body" });
    expect(source.body_ref).toBe(key);
    expect(await store.exists(key)).toBe(true);
    expect(await new Response(await store.get(key)).text()).toBe("fetched body");
    expect(source.metadata).toEqual({
      finalUrl: "https://example.com/article",
      fetchStatus: 200,
      contentType: "text/plain; charset=utf-8",
    });
    expect(source.status).toBe("compiling");
    expect(source.last_error).toBeNull();

    const compile = await compileJobs();
    expect(compile).toHaveLength(1);
    expect(compile[0]?.payload).toEqual({ sourceId, brainId });
    expect(compile[0]?.idempotency_key).toBe(`compile:${sourceId}`);
    expect(compile[0]?.status).toBe("pending");

    expect(await instance.runOnce()).toBe(false);
    expect(await compileJobs()).toHaveLength(1);
  });

  test("a fetched body longer than 4000 characters keeps a preview in Postgres", async () => {
    const created = await capture({
      kind: "url",
      fetchUrl: "https://example.com/long",
      originRef: `long-${crypto.randomUUID()}`,
    });
    expect(created.status).toBe(201);
    const text = "a".repeat(5_000);
    const instance = worker({
      handlers: { "capture.ingest": ingestCapture },
      fetchDocument: () => Promise.resolve({ status: 200, finalUrl: "", contentType: null, text }),
    });

    expect(await instance.runOnce()).toBe(true);

    const source = await sourceRow(created.body.id);
    expect(source.content).toBe(text.slice(0, 4_000));
    expect(source.content_hash).toBe(sha256(text));
    expect(source.body_bytes).toBe(5_000);
    expect(source.original_bytes).toBe(5_000);
  });

  test("a note source skips fetching and still enqueues compile", async () => {
    const created = await capture({ kind: "note", content: "note body" });
    expect(created.status).toBe(201);
    let fetches = 0;
    const instance = worker({
      handlers: { "capture.ingest": ingestCapture },
      fetchDocument: async () => {
        fetches += 1;
        throw new Error("network should not be used");
      },
    });

    expect(await instance.runOnce()).toBe(true);
    expect(fetches).toBe(0);

    const source = await sourceRow(created.body.id);
    expect(source.content).toBe("note body");
    expect(source.content_hash).toBe(created.body.contentHash);
    expect(source.original_bytes).toBe(created.body.originalBytes);
    expect(source.status).toBe("compiling");
    expect(await compileJobs()).toHaveLength(1);
  });

  test("a blocked URL deads the job with a client-safe error", async () => {
    const created = await capture({ kind: "url", fetchUrl: "http://127.0.0.1/secret" });
    expect(created.status).toBe(201);
    const instance = worker({ handlers: { "capture.ingest": ingestCapture } });

    expect(await instance.runOnce()).toBe(true);

    const jobs = await owner.query<JobRow>(
      `SELECT id, status, attempts, max_attempts, last_error, lease_until, available_at
       FROM jobs WHERE tenant_id = $1 AND type = 'capture.ingest'`,
      [tenantId],
    );
    expect(jobs.rows[0]?.status).toBe("dead");
    expect(jobs.rows[0]?.last_error).toBe("URL target is not a public address");
    expect(jobs.rows[0]?.last_error ?? "").not.toContain("127.0.0.1");
    const source = await sourceRow(created.body.id);
    expect(source.content).toBe("http://127.0.0.1/secret");
    expect(source.status).toBe("pending");
    expect(await compileJobs()).toHaveLength(0);
  });

  test("an unknown source deads the job without writing a compile job", async () => {
    const id = await queueJob({
      payload: { sourceId: `src_${"0".repeat(32)}`, brainId },
    });
    const instance = worker({ handlers: { "capture.ingest": ingestCapture } });
    expect(await instance.runOnce()).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("dead");
    expect(row.last_error).toBe("Source not found");
    expect(await compileJobs()).toHaveLength(0);
  });

  test("an invalid payload deads the job with a safe error", async () => {
    const id = await queueJob({ payload: { sourceId: 7 } });
    const instance = worker({ handlers: { "capture.ingest": ingestCapture } });
    expect(await instance.runOnce()).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("dead");
    expect(row.last_error).toBe("Invalid job payload");
  });
});
