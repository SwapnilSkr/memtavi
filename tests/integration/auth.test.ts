import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";
import { hashKey, issueKey } from "../../apps/api/src/lib/keys";
import type { Role } from "../../apps/api/src/lib/roles";

interface BrainBody {
  id: string;
  subjectId: string;
  slug: string;
}

interface ErrorBody {
  path: string;
  message: string;
  timestamp: string;
  body: { message: string; statusCode: number; error: string };
}

interface KeyBody {
  id: string;
  key: string;
}

interface ListBody<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");
const spec = parse(
  await Bun.file(new URL("../../packages/spec/openapi.yaml", import.meta.url)).text(),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function matchesContract(response: Response, body: unknown, path: string, method: string) {
  const operation = spec.paths[path][method];
  let contract = operation.responses[String(response.status)];
  expect(contract !== undefined).toBe(true);
  if (contract.$ref) contract = spec.components.responses[contract.$ref.split("/").at(-1)];
  expect(response.headers.get("x-request-id")).toBeTruthy();
  if (!contract.content) return;
  const schema = contract.content["application/json"].schema;
  const validate = ajv.compile({ ...schema, components: spec.components });
  expect(validate(body)).toBe(true);
}

describe.skipIf(!ownerUrl || !appUrl)("API authentication and tenant scope", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `auth-${crypto.randomUUID()}`;
  const slugB = `auth-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const bootstrapSlug = `auth-bootstrap-${crypto.randomUUID()}`;
  const cliSlug = `auth-cli-${crypto.randomUUID()}`;
  const keys = new Map<string, string>();
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let brainId: string;
  let creation: Response;
  let creationBody: { id: string; subjectId: string; slug: string };
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  function request(
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
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subjectA);
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

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Auth fixtures require a disposable memtavi_test database");
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
    app = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => fixedNow,
    });
    keys.set("owner", await bootstrap(owner, "Auth A", slugA));
    keys.set("foreign", await bootstrap(owner, "Auth B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";
    tenantB = tenants.rows.find((row) => row.slug === slugB)?.id ?? "";
    const actor = await owner.query<{ created_by: string }>(
      "SELECT created_by FROM api_keys WHERE tenant_id = $1",
      [tenantA],
    );
    userA = actor.rows[0]?.created_by ?? "";
    for (const name of ["viewer", "developer", "admin", "expired", "revoked"] as const) {
      const issued = issueKey();
      keys.set(name, issued.key);
      await owner.query(
        `INSERT INTO api_keys (tenant_id, created_by, name, prefix, key_hash, role, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantA,
          userA,
          name,
          issued.prefix,
          issued.hash,
          ["expired", "revoked"].includes(name) ? "viewer" : name,
          name === "expired" ? "2000-01-01T00:00:00Z" : null,
          name === "revoked" ? "2000-01-01T00:00:00Z" : null,
        ],
      );
    }
    creation = await request("/v1/brains", {
      key: keys.get("owner"),
      method: "POST",
      body: { name: "Gate Brain", slug: "gate", briefSettings: { enabled: true } },
      id: "gate-request",
    });
    creationBody = (await creation.json()) as BrainBody;
    brainId = creationBody.id;
  });

  afterAll(async () => {
    if (fixturesAuthorized) {
      const actors = await owner.query<{ created_by: string }>(
        `SELECT k.created_by FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
         WHERE t.slug = ANY($1::text[])`,
        [[slugA, slugB, bootstrapSlug, cliSlug]],
      );
      await owner.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [
        [slugA, slugB, bootstrapSlug, cliSlug],
      ]);
      await owner.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [...new Set(actors.rows.map((row) => row.created_by))],
      ]);
    }
    await Promise.all([owner.end(), application.end()]);
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  });

  test("gate: tenant B gets 404 for the brain tenant A created with 201", async () => {
    const foreign = await request(`/v1/brains/${brainId}`, { key: keys.get("foreign") });
    expect(foreign.status).toBe(404);
    const foreignBody = (await foreign.json()) as ErrorBody;
    matchesContract(foreign, foreignBody, "/v1/brains/{brainId}", "get");
    const missing = await request(`/v1/brains/${newId("brain")}`, { key: keys.get("foreign") });
    const missingBody = (await missing.json()) as ErrorBody;
    expect({ ...foreignBody, path: missingBody.path }).toEqual(missingBody);
    expect(creation.status).toBe(201);
    matchesContract(creation, creationBody, "/v1/brains", "post");
    expect(creationBody.id.startsWith("brn_")).toBe(true);
    expect(creationBody.subjectId).toBe(subjectA);
    expect(creation.headers.get("x-request-id")).toBe("gate-request");
    const own = await request(`/v1/brains/${brainId}`, { key: keys.get("owner") });
    expect(own.status).toBe(200);
    matchesContract(own, await own.json(), "/v1/brains/{brainId}", "get");
  });

  test("another subject cannot read or list the brain", async () => {
    const foreign = await request(`/v1/brains/${brainId}`, {
      key: keys.get("owner"),
      subject: subjectB,
    });
    expect(foreign.status).toBe(404);
    const hidden = await request("/v1/brains", { key: keys.get("owner"), subject: subjectB });
    expect(((await hidden.json()) as ListBody<BrainBody>).items).toHaveLength(0);
    const own = await request("/v1/brains?limit=1&offset=0", { key: keys.get("owner") });
    const body = (await own.json()) as ListBody<BrainBody>;
    matchesContract(own, body, "/v1/brains", "get");
    const all = await request("/v1/brains", { key: keys.get("owner") });
    expect(((await all.json()) as ListBody<BrainBody>).items.map((item) => item.id)).toContain(
      brainId,
    );
    expect(body.limit).toBe(1);
  });

  test.each([
    ["missing", "Missing API key"],
    ["unknown", "Invalid API key"],
    ["revoked", "Invalid API key"],
    ["expired", "Invalid API key"],
  ])("%s key is rejected with the error envelope", async (name, message) => {
    const response = await request("/v1/brains", {
      ...(name === "missing"
        ? {}
        : { key: name === "unknown" ? "mtv_live_unknown" : keys.get(name) }),
      id: "denied-request",
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as ErrorBody;
    matchesContract(response, body, "/v1/brains", "get");
    expect(body.message).toBe(message);
    expect(body.body.message).toBe(message);
    expect(body.body.statusCode).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("denied-request");
  });

  test.each(["malformed", "", null])("subject %s is rejected on brain routes", async (subject) => {
    const response = await request("/v1/brains", { key: keys.get("owner"), subject });
    expect(response.status).toBe(400);
    matchesContract(response, await response.json(), "/v1/brains", "get");
  });

  test("viewer cannot create a brain; developer can", async () => {
    const denied = await request("/v1/brains", {
      key: keys.get("viewer"),
      method: "POST",
      body: { name: "Denied" },
    });
    expect(denied.status).toBe(403);
    matchesContract(denied, await denied.json(), "/v1/brains", "post");
    const accepted = await request("/v1/brains", {
      key: keys.get("developer"),
      method: "POST",
      body: { name: "Developer", slug: `developer-${crypto.randomUUID()}` },
    });
    expect(accepted.status).toBe(201);
    matchesContract(accepted, await accepted.json(), "/v1/brains", "post");
  });

  test("duplicate slugs conflict only within the same tenant and subject", async () => {
    const hidden = await request(`/v1/brains/${brainId}`, { key: keys.get("foreign") });
    expect(hidden.status).toBe(404);
    const duplicate = await request("/v1/brains", {
      key: keys.get("owner"),
      method: "POST",
      body: { name: "Duplicate", slug: "gate" },
    });
    expect(duplicate.status).toBe(409);
    matchesContract(duplicate, await duplicate.json(), "/v1/brains", "post");
    for (const options of [
      { key: keys.get("foreign") },
      { key: keys.get("owner"), subject: crypto.randomUUID() },
    ]) {
      const accepted = await request("/v1/brains", {
        ...options,
        method: "POST",
        body: { name: "Separate", slug: "gate" },
      });
      expect(accepted.status).toBe(201);
    }
  });

  test("key creation is one-time plaintext, tenant-scoped, audited, and immediately revocable", async () => {
    const created = await request("/v1/api-keys", {
      key: keys.get("admin"),
      subject: null,
      method: "POST",
      body: { name: "Lifecycle", role: "developer", scopes: ["capture"] },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as KeyBody;
    matchesContract(created, body, "/v1/api-keys", "post");
    expect(/^mtv_live_[A-Za-z0-9_-]{43}$/.test(body.key)).toBe(true);
    expect("keyHash" in body || "key_hash" in body).toBe(false);
    const foreign = await request(`/v1/api-keys/${body.id}`, {
      key: keys.get("foreign"),
      subject: null,
      method: "DELETE",
    });
    expect(foreign.status).toBe(404);
    matchesContract(foreign, await foreign.json(), "/v1/api-keys/{keyId}", "delete");
    const stored = await owner.query<{ key_hash: string; role: Role }>(
      "SELECT key_hash, role FROM api_keys WHERE tenant_id = $1 AND id = $2",
      [tenantA, body.id],
    );
    expect(stored.rows[0]?.key_hash === hashKey(body.key)).toBe(true);
    const used = await request("/v1/brains", { key: body.key });
    expect(used.status).toBe(200);
    const listed = await request("/v1/api-keys", { key: keys.get("owner"), subject: null });
    const listedBody = (await listed.json()) as ListBody<KeyBody>;
    matchesContract(listed, listedBody, "/v1/api-keys", "get");
    expect(listedBody.items.some((item: { id: string }) => item.id === body.id)).toBe(true);
    expect(JSON.stringify(listedBody).includes(body.key)).toBe(false);
    expect(
      listedBody.items.every(
        (item: object) => !("key" in item || "keyHash" in item || "key_hash" in item),
      ),
    ).toBe(true);
    const revoked = await request(`/v1/api-keys/${body.id}`, {
      key: keys.get("admin"),
      subject: null,
      method: "DELETE",
    });
    expect(revoked.status).toBe(204);
    expect(await revoked.text()).toBe("");
    matchesContract(revoked, null, "/v1/api-keys/{keyId}", "delete");
    const rejected = await request("/v1/brains", { key: body.key });
    expect(rejected.status).toBe(401);
    const audit = await owner.query<{ action: string; metadata: object }>(
      "SELECT action, metadata FROM audit_events WHERE tenant_id = $1 AND target_id = $2 ORDER BY action",
      [tenantA, body.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["api_key.created", "api_key.revoked"]);
    expect(audit.rows.every((row) => JSON.stringify(row.metadata) === "{}")).toBe(true);
    expect(JSON.stringify(audit.rows).includes(body.key)).toBe(false);
  });

  test.each([
    ["admin", "owner", 403],
    ["admin", "developer", 204],
    ["owner", "admin", 204],
  ] as const)(
    "%s revoking %s returns %i and preserves authentication state",
    async (caller, role, status) => {
      const created = await request("/v1/api-keys", {
        key: keys.get("owner"),
        subject: null,
        method: "POST",
        body: { name: `Revocation ${caller} to ${role}`, role },
      });
      expect(created.status).toBe(201);
      const target = (await created.json()) as KeyBody;
      const foreign = await request(`/v1/api-keys/${target.id}`, {
        key: keys.get("foreign"),
        subject: null,
        method: "DELETE",
      });
      expect(foreign.status).toBe(404);
      matchesContract(foreign, await foreign.json(), "/v1/api-keys/{keyId}", "delete");
      const revoked = await request(`/v1/api-keys/${target.id}`, {
        key: keys.get(caller),
        subject: null,
        method: "DELETE",
      });
      expect(revoked.status).toBe(status);
      const body = status === 403 ? ((await revoked.json()) as ErrorBody) : null;
      matchesContract(revoked, body, "/v1/api-keys/{keyId}", "delete");
      if (body) expect(body.body.error).toBe("ForbiddenError");
      const authenticated = await request("/v1/brains", { key: target.key });
      expect(authenticated.status).toBe(status === 403 ? 200 : 401);
    },
  );

  test("listing API keys writes no audit rows", async () => {
    const before = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM audit_events WHERE tenant_id = $1",
      [tenantA],
    );
    const listed = await request("/v1/api-keys", { key: keys.get("owner"), subject: null });
    expect(listed.status).toBe(200);
    matchesContract(listed, await listed.json(), "/v1/api-keys", "get");
    const after = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM audit_events WHERE tenant_id = $1",
      [tenantA],
    );
    expect(after.rows[0]?.total).toBe(before.rows[0]?.total);
  });

  test.each(["viewer", "developer"])("%s cannot manage keys", async (role) => {
    for (const [method, path, body] of [
      ["GET", "/v1/api-keys", undefined],
      ["POST", "/v1/api-keys", { name: "Denied" }],
      ["DELETE", `/v1/api-keys/${crypto.randomUUID()}`, undefined],
    ] as const) {
      const response = await request(path, { key: keys.get(role), method, subject: null, body });
      expect(response.status).toBe(403);
    }
  });

  test("admin cannot mint an owner key", async () => {
    const response = await request("/v1/api-keys", {
      key: keys.get("admin"),
      subject: null,
      method: "POST",
      body: { name: "Escalation", role: "owner" },
    });
    expect(response.status).toBe(403);
    matchesContract(response, await response.json(), "/v1/api-keys", "post");
  });

  test("tenant reads require owner and work without a subject header", async () => {
    const denied = await request("/v1/tenant", { key: keys.get("admin"), subject: null });
    expect(denied.status).toBe(403);
    matchesContract(denied, await denied.json(), "/v1/tenant", "get");
    const response = await request("/v1/tenant", { key: keys.get("owner"), subject: null });
    const body = (await response.json()) as { id: string };
    expect(response.status).toBe(200);
    expect(body.id).toBe(tenantA);
    matchesContract(response, body, "/v1/tenant", "get");
  });

  test("last-used writes are throttled and resume after 60 seconds without waiting", async () => {
    const key = keys.get("viewer") ?? "";
    const hash = hashKey(key);
    await owner.query(
      "UPDATE api_keys SET last_used_at = NULL WHERE tenant_id = $1 AND key_hash = $2",
      [tenantA, hash],
    );
    expect((await request("/v1/brains", { key })).status).toBe(200);
    const first = await owner.query<{ stamp: string }>(
      "SELECT last_used_at::text AS stamp FROM api_keys WHERE tenant_id = $1 AND key_hash = $2",
      [tenantA, hash],
    );
    await Promise.all(Array.from({ length: 4 }, () => request("/v1/brains", { key })));
    const repeated = await owner.query<{ stamp: string }>(
      "SELECT last_used_at::text AS stamp FROM api_keys WHERE tenant_id = $1 AND key_hash = $2",
      [tenantA, hash],
    );
    expect(repeated.rows[0]?.stamp).toBe(first.rows[0]?.stamp);
    await owner.query(
      "UPDATE api_keys SET last_used_at = '2000-01-01' WHERE tenant_id = $1 AND key_hash = $2",
      [tenantA, hash],
    );
    expect((await request("/v1/brains", { key })).status).toBe(200);
    const refreshed = await owner.query<{ fresh: boolean }>(
      "SELECT last_used_at > '2000-01-02'::timestamptz AS fresh FROM api_keys WHERE tenant_id = $1 AND key_hash = $2",
      [tenantA, hash],
    );
    expect(refreshed.rows[0]?.fresh).toBe(true);
  });

  test.each([
    ["/v1/brains", "POST", { name: "" }],
    ["/v1/brains?limit=201", "GET", undefined],
    ["/v1/brains?limit=1.5", "GET", undefined],
    ["/v1/brains?offset=-1", "GET", undefined],
    ["/v1/brains?offset=0.5", "GET", undefined],
    ["/v1/api-keys", "POST", { name: "Bad", role: "root" }],
    ["/v1/api-keys", "POST", { name: "Bad", expiresAt: "never" }],
  ])("invalid request %s %s produces a safe 400", async (path, method, body) => {
    const response = await request(path, { key: keys.get("owner"), method, body });
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).message).toBe("Invalid request");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  test("malformed JSON and missing routes echo request ids with the envelope", async () => {
    const malformed = await app.handle(
      new Request("http://localhost/v1/brains", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "parse-error" },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    matchesContract(malformed, await malformed.json(), "/v1/brains", "post");
    expect(malformed.headers.get("x-request-id")).toBe("parse-error");
    const missing = await request("/not-a-route", { id: "missing-route" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-request-id")).toBe("missing-route");
    expect(((await missing.json()) as ErrorBody).body.error).toBe("NotFoundError");
  });

  test("unknown server errors expose no SQL, key, or stack", async () => {
    const failing = createApp({
      ownerPool: owner,
      withTenant: async () => {
        throw new Error("SELECT secret FROM private_table");
      },
      store: createFakeStore(),
      now: () => fixedNow,
    });
    const response = await failing.handle(
      new Request("http://localhost/v1/brains", {
        headers: { "x-api-key": keys.get("owner") ?? "", "x-subject-id": subjectA },
      }),
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as ErrorBody;
    matchesContract(response, body, "/v1/brains", "get");
    expect(body.message).toBe("Internal server error");
    expect(body.body.error).toBe("InternalServerError");
    expect(body.timestamp).toBe(fixedNow.toISOString());
    expect(JSON.stringify(body).includes("SELECT")).toBe(false);
    expect("stack" in body).toBe(false);
  });

  test("bootstrap refuses a second first key and serializes concurrent attempts", async () => {
    await expect(bootstrap(owner, "Existing", slugA)).rejects.toThrow(
      "Tenant already has an API key",
    );
    const results = await Promise.allSettled([
      bootstrap(owner, "Concurrent", bootstrapSlug),
      bootstrap(owner, "Concurrent", bootstrapSlug),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const count = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE t.slug = $1",
      [bootstrapSlug],
    );
    expect(count.rows[0]?.total).toBe(1);
  });

  test("bootstrap CLI prints one key once and no extra output", async () => {
    const command = [
      process.execPath,
      "run",
      "apps/api/src/bin/bootstrap.ts",
      "--name",
      "CLI tenant",
      "--slug",
      cliSlug,
    ];
    const env = { PATH: process.env.PATH ?? "", DATABASE_URL: ownerUrl ?? "" };
    const first = Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe" });
    const firstOutput = await new Response(first.stdout).text();
    const firstError = await new Response(first.stderr).text();
    expect(await first.exited).toBe(0);
    expect(/^mtv_live_[A-Za-z0-9_-]{43}\n$/.test(firstOutput)).toBe(true);
    expect(firstError.length).toBe(0);
    const second = Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe" });
    const secondOutput = await new Response(second.stdout).text();
    const secondError = await new Response(second.stderr).text();
    expect(await second.exited).toBe(1);
    expect(secondOutput.length).toBe(0);
    expect(secondError).toBe("Bootstrap failed\n");
  });

  test("authentication denials increment a counter without storing credentials", async () => {
    const before = app.decorator.securityDenials[401];
    expect((await request("/v1/brains")).status).toBe(401);
    expect(app.decorator.securityDenials[401]).toBeGreaterThan(before);
  });

  test("application role cannot read users or tenants; missing context sees no brains", async () => {
    await expect(application.query("SELECT id FROM users LIMIT 1")).rejects.toThrow();
    await expect(application.query("SELECT id FROM tenants LIMIT 1")).rejects.toThrow();
    expect((await application.query("SELECT id FROM brains")).rowCount).toBe(0);
    const foreign = await request(`/v1/brains/${brainId}`, { key: keys.get("foreign") });
    expect(foreign.status).toBe(404);
    const count = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM brains WHERE tenant_id = $1 AND id = $2",
      [tenantB, brainId],
    );
    expect(count.rows[0]?.total).toBe(0);
  });
});
