import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { decryptWebhookSecret } from "@memtavi/shared/webhooks";
import { createFakeStore } from "@memtavi/storage/fake";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface WebhookBody {
  id: string;
  subjectId: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
}

interface ErrorBody {
  statusCode: number;
  path: string;
  message: string;
  timestamp: string;
  body: { message: string; error: string; statusCode: number };
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
const testKey = Buffer.alloc(32, 3).toString("base64");
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

describe.skipIf(!ownerUrl || !appUrl)("webhook registration", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const slugA = `hooks-${crypto.randomUUID()}`;
  const slugB = `hooks-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const keys = new Map<string, string>();
  let tenantA: string;
  let tenantB: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let unconfigured: ReturnType<typeof createApp>;
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
      target?: ReturnType<typeof createApp>;
    } = {},
  ) {
    const headers = new Headers();
    if (options.key !== undefined) headers.set("x-api-key", options.key);
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subjectA);
    if (options.id) headers.set("x-request-id", options.id);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return (options.target ?? app).handle(
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
      throw new Error("Webhook fixtures require a disposable memtavi_test database");
    }
    const appDatabase = await owner.query<{ role: string; rolsuper: boolean }>(
      "SELECT current_user AS role, rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    expect(appDatabase.rows[0]?.role).toBe("memtavi");
    fixturesAuthorized = true;
    process.env.APP_DATABASE_URL = appUrl;
    db = await import("@memtavi/db/client");
    app = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => fixedNow,
      webhookSecretKey: testKey,
    });
    unconfigured = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => fixedNow,
    });
    keys.set("owner", await bootstrap(owner, "Hooks A", slugA));
    keys.set("foreign", await bootstrap(owner, "Hooks B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";
    tenantB = tenants.rows.find((row) => row.slug === slugB)?.id ?? "";
  });

  afterAll(async () => {
    if (fixturesAuthorized) {
      const actors = await owner.query<{ created_by: string }>(
        `SELECT k.created_by FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
         WHERE t.slug = ANY($1::text[])`,
        [[slugA, slugB]],
      );
      await owner.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [[slugA, slugB]]);
      await owner.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [...new Set(actors.rows.map((row) => row.created_by))],
      ]);
    }
    await owner.end();
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  });

  test("create returns the secret once and stores it encrypted", async () => {
    const response = await request("/v1/webhooks", {
      key: keys.get("owner"),
      method: "POST",
      body: { url: "https://example.com/hooks", events: ["created", "updated"] },
      id: "hook-create",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("hook-create");
    const body = (await response.json()) as WebhookBody;
    matchesContract(response, body, "/v1/webhooks", "post");
    expect(body.secret?.startsWith("whsec_")).toBe(true);
    expect(body.events).toEqual(["created", "updated"]);
    expect(body.subjectId).toBe(subjectA);

    const stored = await owner.query<{ secret_enc: string }>(
      "SELECT secret_enc FROM webhooks WHERE tenant_id = $1 AND id = $2",
      [tenantA, body.id],
    );
    const encrypted = stored.rows[0]?.secret_enc ?? "";
    expect(encrypted).not.toContain(body.secret ?? "");
    expect(decryptWebhookSecret(encrypted, testKey)).toBe(body.secret ?? "");
  });

  test("list omits the secret and is scoped to the subject", async () => {
    const created = await request("/v1/webhooks", {
      key: keys.get("owner"),
      method: "POST",
      body: { url: "https://example.com/second", events: ["routed"] },
    });
    expect(created.status).toBe(201);
    const listed = await request("/v1/webhooks", {
      key: keys.get("owner"),
    });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as ListBody<WebhookBody>;
    matchesContract(listed, listedBody, "/v1/webhooks", "get");
    expect(listedBody.items.length).toBeGreaterThan(0);
    expect(listedBody.items.every((item) => !("secret" in item))).toBe(true);
    expect(JSON.stringify(listedBody).includes("whsec_")).toBe(false);

    const other = await request("/v1/webhooks", {
      key: keys.get("owner"),
      subject: crypto.randomUUID(),
    });
    expect(other.status).toBe(200);
    expect(((await other.json()) as ListBody<WebhookBody>).items).toHaveLength(0);
  });

  test("delete is 204 and a foreign webhook is 404", async () => {
    const created = await request("/v1/webhooks", {
      key: keys.get("owner"),
      method: "POST",
      body: { url: "https://example.com/delete-me", events: ["created"] },
    });
    const webhook = (await created.json()) as WebhookBody;

    const foreign = await request(`/v1/webhooks/${webhook.id}`, {
      key: keys.get("foreign"),
      method: "DELETE",
    });
    expect(foreign.status).toBe(404);
    matchesContract(foreign, await foreign.json(), "/v1/webhooks/{webhookId}", "delete");
    const stillThere = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM webhooks WHERE tenant_id = $1 AND id = $2",
      [tenantA, webhook.id],
    );
    expect(stillThere.rows[0]?.total).toBe(1);

    const deleted = await request(`/v1/webhooks/${webhook.id}`, {
      key: keys.get("owner"),
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    matchesContract(deleted, null, "/v1/webhooks/{webhookId}", "delete");

    const again = await request(`/v1/webhooks/${webhook.id}`, {
      key: keys.get("owner"),
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });

  test("an unknown event is 422 and is not stored", async () => {
    const response = await request("/v1/webhooks", {
      key: keys.get("owner"),
      method: "POST",
      body: { url: "https://example.com/hooks", events: ["created", "exploded"] },
    });
    expect(response.status).toBe(422);
    matchesContract(response, await response.json(), "/v1/webhooks", "post");
    const count = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM webhooks WHERE tenant_id = $1 AND subject_id = $2",
      [tenantA, subjectA],
    );
    expect(count.rows[0]?.total).toBe(2);
  });

  test.each([
    ["ftp", "ftp://example.com/hooks"],
    ["credentials", "https://user:pass@example.com/hooks"],
    ["relative", "not-a-url"],
  ])("a %s URL is rejected with 400", async (_label, url) => {
    const response = await request("/v1/webhooks", {
      key: keys.get("owner"),
      method: "POST",
      body: { url, events: ["created"] },
    });
    expect(response.status).toBe(400);
    matchesContract(response, await response.json(), "/v1/webhooks", "post");
  });

  test("creating without a configured key fails with a clear 500", async () => {
    const response = await request("/v1/webhooks", {
      key: keys.get("owner"),
      target: unconfigured,
      method: "POST",
      body: { url: "https://example.com/hooks", events: ["created"] },
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as ErrorBody;
    matchesContract(response, body, "/v1/webhooks", "post");
    expect(body.message).toBe("Webhook signing is not configured on this server");
    expect(body.body.error).toBe("InternalServerError");
    expect(JSON.stringify(body).includes("secret")).toBe(false);
  });

  test("a missing subject header is rejected before any row is read", async () => {
    const response = await request("/v1/webhooks", { key: keys.get("owner"), subject: null });
    expect(response.status).toBe(400);
    matchesContract(response, await response.json(), "/v1/webhooks", "get");
    const foreignTenant = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM webhooks WHERE tenant_id = $1",
      [tenantB],
    );
    expect(foreignTenant.rows[0]?.total).toBe(0);
  });
});
