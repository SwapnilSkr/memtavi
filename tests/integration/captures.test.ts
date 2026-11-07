import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createApp } from "@memtavi/api/app";
import { createFakeStore } from "@memtavi/storage/fake";
import { sourceKey } from "@memtavi/storage/keys";
import type { ObjectBody, ObjectStore } from "@memtavi/storage/types";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface SourceBody {
  id: string;
  brainId: string;
  kind: string;
  contentPreview: string;
  contentUrl: string | null;
  contentHash: string;
  originRef: string | null;
  label: string | null;
  bucket: string;
  metadata: Record<string, unknown>;
  status: string;
  attempts: number;
  lastError: string | null;
  affectedPageIds: string[];
  originalBytes: number;
  createdAt: string;
  compiledAt: string | null;
  deletedAt: string | null;
}

interface PutRecord {
  key: string;
  body: ObjectBody;
  contentType: string;
}

function recordingStore() {
  const inner = createFakeStore();
  const puts: PutRecord[] = [];
  const store: ObjectStore = {
    async put(key, body, contentType) {
      puts.push({ key, body, contentType });
      await inner.put(key, body, contentType);
    },
    get: (key) => inner.get(key),
    delete: (key) => inner.delete(key),
    exists: (key) => inner.exists(key),
    async signedUrl(key, ttlSeconds) {
      return `https://signed.example/${key}?ttl=${ttlSeconds}`;
    },
  };
  return { store, puts };
}

interface ListBody<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface BrainBody {
  id: string;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");
const spec = parse(
  await Bun.file(new URL("../../packages/spec/openapi.yaml", import.meta.url)).text(),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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

describe.skipIf(!ownerUrl || !appUrl)("captures and ingest sources", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `capture-${crypto.randomUUID()}`;
  const slugB = `capture-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const keys = new Map<string, string>();
  let tenantA: string;
  let tenantB: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let store: ObjectStore;
  let puts: PutRecord[];
  let brainId: string;
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  function request(
    path: string,
    options: {
      key?: string | undefined;
      subject?: string | null;
      method?: string;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ) {
    const headers = new Headers();
    headers.set("x-api-key", options.key ?? keys.get("owner") ?? "");
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subjectA);
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  function capture(body: unknown, key?: string) {
    return request(`/v1/brains/${brainId}/captures`, {
      key: keys.get("owner"),
      method: "POST",
      body,
      ...(key === undefined ? {} : { idempotencyKey: key }),
    });
  }

  async function sourceCount(): Promise<number> {
    const result = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM ingest_sources WHERE tenant_id = $1 AND brain_id = $2",
      [tenantA, brainId],
    );
    return result.rows[0]?.total ?? 0;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Capture fixtures require a disposable memtavi_test database");
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
    ({ store, puts } = recordingStore());
    app = createApp({ ownerPool: owner, withTenant: db.withTenant, store, now: () => fixedNow });
    keys.set("owner", await bootstrap(owner, "Capture A", slugA));
    keys.set("foreign", await bootstrap(owner, "Capture B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";
    tenantB = tenants.rows.find((row) => row.slug === slugB)?.id ?? "";
    const brain = await request("/v1/brains", {
      key: keys.get("owner"),
      method: "POST",
      body: { name: "Capture Brain", slug: `brain-${crypto.randomUUID()}` },
    });
    expect(brain.status).toBe(201);
    brainId = ((await brain.json()) as BrainBody).id;
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
    await Promise.all([owner.end(), application.end()]);
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  });

  test("a note capture creates one pending source and exactly one job", async () => {
    const response = await capture({
      kind: "note",
      content: "hello world",
      originRef: "note-1",
      label: "Note",
      bucket: "notes",
      metadata: { tag: "alpha" },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as SourceBody;
    matchesContract(response, body, "/v1/brains/{brainId}/captures", "post");
    expect(body.id).toMatch(/^src_[0-9a-f]{32}$/);
    expect(body.brainId).toBe(brainId);
    expect(body.kind).toBe("note");
    expect(body.contentPreview).toBe("hello world");
    expect(body.contentUrl).toBeNull();
    expect(body.contentHash).toBe(sha256("hello world"));
    expect(body.originRef).toBe("note-1");
    expect(body.label).toBe("Note");
    expect(body.bucket).toBe("notes");
    expect(body.metadata).toEqual({ tag: "alpha" });
    expect(body.status).toBe("pending");
    expect(body.attempts).toBe(0);
    expect(body.lastError).toBeNull();
    expect(body.affectedPageIds).toEqual([]);
    expect(body.originalBytes).toBe(Buffer.byteLength("hello world"));
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
    expect(body.compiledAt).toBeNull();
    expect(body.deletedAt).toBeNull();

    const job = await owner.query<{
      type: string;
      payload: { sourceId: string; brainId: string };
      idempotency_key: string;
      max_attempts: number;
      status: string;
      available_at: Date;
    }>(
      "SELECT type, payload, idempotency_key, max_attempts, status, available_at FROM jobs WHERE tenant_id = $1 AND idempotency_key = $2",
      [tenantA, `capture:${body.id}`],
    );
    expect(job.rowCount).toBe(1);
    expect(job.rows[0]?.type).toBe("capture.ingest");
    expect(job.rows[0]?.payload).toEqual({ sourceId: body.id, brainId });
    expect(job.rows[0]?.max_attempts).toBe(5);
    expect(job.rows[0]?.status).toBe("pending");
    expect(job.rows[0]?.available_at).toBeInstanceOf(Date);

    const read = await request(`/v1/brains/${brainId}/sources/${body.id}`);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as SourceBody;
    matchesContract(read, readBody, "/v1/brains/{brainId}/sources/{sourceId}", "get");
    const { contentUrl, ...readRest } = readBody;
    const { contentUrl: capturedUrl, ...captured } = body;
    expect(capturedUrl).toBeNull();
    expect(readRest).toEqual(captured);
    expect(contentUrl).toContain(`?ttl=300`);
  });

  test("an inline capture writes one object and keeps a 4000-character preview", async () => {
    const content = "é".repeat(4_500);
    const before = puts.length;
    const response = await capture({ kind: "note", content, originRef: "store-1" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as SourceBody;
    matchesContract(response, body, "/v1/brains/{brainId}/captures", "post");
    expect(body.contentPreview).toBe(content.slice(0, 4_000));
    expect(body.contentPreview.length).toBe(4_000);

    expect(puts.length - before).toBe(1);
    const written = puts[before];
    expect(written?.body).toBe(content);
    expect(written?.contentType).toBe("text/plain; charset=utf-8");

    const stored = await owner.query<{ bodyRef: string; bodyBytes: number }>(
      `SELECT body_ref AS "bodyRef", body_bytes AS "bodyBytes"
       FROM ingest_sources WHERE tenant_id = $1 AND id = $2`,
      [tenantA, body.id],
    );
    const key = sourceKey({ tenantId: tenantA, sourceId: body.id, body: content });
    expect(stored.rows[0]?.bodyRef).toBe(key);
    expect(stored.rows[0]?.bodyBytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(await store.exists(key)).toBe(true);
    expect(await new Response(await store.get(key)).text()).toBe(content);
  });

  test("the content endpoint signs the stored body for 300 seconds", async () => {
    const response = await capture({ kind: "note", content: "signed body", originRef: "sign-1" });
    expect(response.status).toBe(201);
    const source = (await response.json()) as SourceBody;
    const key = sourceKey({ tenantId: tenantA, sourceId: source.id, body: "signed body" });

    const read = await request(`/v1/brains/${brainId}/sources/${source.id}/content`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as { url: string | null; expiresAt: string | null };
    matchesContract(read, body, "/v1/brains/{brainId}/sources/{sourceId}/content", "get");
    expect(body.url).toBe(`https://signed.example/${key}?ttl=300`);
    expect(body.expiresAt).toBe(new Date(fixedNow.getTime() + 300_000).toISOString());
  });

  test("the content endpoint returns 404 for a source without a stored body", async () => {
    const response = await capture({ kind: "url", fetchUrl: "https://example.com/no-body" });
    expect(response.status).toBe(201);
    const source = (await response.json()) as SourceBody;
    expect(source.contentUrl).toBeNull();
    const read = await request(`/v1/brains/${brainId}/sources/${source.id}/content`);
    expect(read.status).toBe(404);
    matchesContract(
      read,
      await read.json(),
      "/v1/brains/{brainId}/sources/{sourceId}/content",
      "get",
    );
    const missing = await request(`/v1/brains/${brainId}/sources/src_${"0".repeat(32)}/content`);
    expect(missing.status).toBe(404);
    matchesContract(
      missing,
      await missing.json(),
      "/v1/brains/{brainId}/sources/{sourceId}/content",
      "get",
    );
  });

  test.each([
    ["both content and fetchUrl", { kind: "note", content: "x", fetchUrl: "https://example.com" }],
    ["neither content nor fetchUrl", { kind: "note" }],
    ["both null", { kind: "note", content: null, fetchUrl: null }],
    ["an unknown kind", { kind: "voice", content: "x" }],
  ])("rejects %s with 400 and writes nothing", async (_label, body) => {
    const before = await sourceCount();
    const response = await capture(body);
    expect(response.status).toBe(400);
    matchesContract(response, await response.json(), "/v1/brains/{brainId}/captures", "post");
    expect(await sourceCount()).toBe(before);
  });

  test("the inline content limit is 50000 characters inclusive", async () => {
    const accepted = await capture({ kind: "note", content: "a".repeat(50_000) });
    expect(accepted.status).toBe(201);
    matchesContract(accepted, await accepted.json(), "/v1/brains/{brainId}/captures", "post");
    const rejected = await capture({ kind: "note", content: "a".repeat(50_001) });
    expect(rejected.status).toBe(400);
    matchesContract(rejected, await rejected.json(), "/v1/brains/{brainId}/captures", "post");
  });

  test.each([
    ["file:///etc/passwd"],
    ["ftp://example.com/file.txt"],
    ["data:text/plain,hello"],
    ["not a url"],
  ])("rejects the non-http fetchUrl %s with 400 without resolving it", async (fetchUrl) => {
    const before = await sourceCount();
    const response = await capture({ kind: "url", fetchUrl });
    expect(response.status).toBe(400);
    matchesContract(response, await response.json(), "/v1/brains/{brainId}/captures", "post");
    expect(await sourceCount()).toBe(before);
  });

  test("a fetchUrl is stored as the source content and never fetched", async () => {
    const fetchUrl = "https://example.com/article";
    const response = await capture({ kind: "url", fetchUrl, originRef: "url-1" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as SourceBody;
    matchesContract(response, body, "/v1/brains/{brainId}/captures", "post");
    expect(body.contentPreview).toBe(fetchUrl);
    expect(body.contentHash).toBe(sha256(fetchUrl));
    expect(body.originalBytes).toBe(0);
    expect(body.status).toBe("pending");
  });

  test("another tenant gets 404 for the brain and cannot read its sources", async () => {
    const foreign = await request(`/v1/brains/${brainId}/captures`, {
      key: keys.get("foreign"),
      method: "POST",
      body: { kind: "note", content: "intruder" },
    });
    expect(foreign.status).toBe(404);
    matchesContract(foreign, await foreign.json(), "/v1/brains/{brainId}/captures", "post");
    const listed = await request(`/v1/brains/${brainId}/sources`, { key: keys.get("foreign") });
    expect(listed.status).toBe(404);
    const owned = await capture({
      kind: "note",
      content: "owned body",
      originRef: "foreign-probe",
    });
    expect(owned.status).toBe(201);
    const ownerSource = (await owned.json()) as SourceBody;
    const content = await request(`/v1/brains/${brainId}/sources/${ownerSource.id}/content`, {
      key: keys.get("foreign"),
    });
    expect(content.status).toBe(404);
    const stored = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM ingest_sources WHERE tenant_id = $1",
      [tenantB],
    );
    expect(stored.rows[0]?.total).toBe(0);
  });

  test("the content endpoint reports nulls when the store cannot sign", async () => {
    const unsigned = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => fixedNow,
    });
    const created = await capture({ kind: "note", content: "no signing", originRef: "nosign-1" });
    expect(created.status).toBe(201);
    const source = (await created.json()) as SourceBody;
    const response = await unsigned.handle(
      new Request(`http://localhost/v1/brains/${brainId}/sources/${source.id}/content`, {
        headers: { "x-api-key": keys.get("owner") ?? "", "x-subject-id": subjectA },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: null; expiresAt: null };
    matchesContract(response, body, "/v1/brains/{brainId}/sources/{sourceId}/content", "get");
    expect(body).toEqual({ url: null, expiresAt: null });
  });

  test("an Idempotency-Key replays byte-for-byte and creates no second job", async () => {
    const key = crypto.randomUUID();
    const body = { kind: "note", content: "replay me", metadata: { n: 1 } };
    const first = await capture(body, key);
    const firstText = await first.text();
    expect(first.status).toBe(201);
    matchesContract(first, JSON.parse(firstText), "/v1/brains/{brainId}/captures", "post");
    const replayed = await capture(body, key);
    const replayedText = await replayed.text();
    expect(replayed.status).toBe(201);
    expect(replayedText).toBe(firstText);
    const stored = JSON.parse(firstText) as SourceBody;
    const jobs = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM jobs WHERE tenant_id = $1 AND idempotency_key = $2",
      [tenantA, `capture:${stored.id}`],
    );
    expect(jobs.rows[0]?.total).toBe(1);
    const sources = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM ingest_sources WHERE tenant_id = $1 AND content = $2",
      [tenantA, "replay me"],
    );
    expect(sources.rows[0]?.total).toBe(1);
    const conflict = await capture({ ...body, content: "different" }, key);
    expect(conflict.status).toBe(409);
    matchesContract(conflict, await conflict.json(), "/v1/brains/{brainId}/captures", "post");
  });

  test("the same originRef returns the existing source with 200", async () => {
    const first = await capture({ kind: "note", content: "original", originRef: "dedupe-1" });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as SourceBody;
    const second = await capture({ kind: "note", content: "replacement", originRef: "dedupe-1" });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as SourceBody;
    matchesContract(second, secondBody, "/v1/brains/{brainId}/captures", "post");
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.contentPreview).toBe("original");
    const jobs = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM jobs WHERE tenant_id = $1 AND idempotency_key = $2",
      [tenantA, `capture:${firstBody.id}`],
    );
    expect(jobs.rows[0]?.total).toBe(1);
  });

  test("deleting a source is a soft, idempotent delete that leaves derived pages alone", async () => {
    const created = await capture({ kind: "note", content: "delete me", originRef: "delete-1" });
    expect(created.status).toBe(201);
    const source = (await created.json()) as SourceBody;
    const first = await request(`/v1/brains/${brainId}/sources/${source.id}`, {
      method: "DELETE",
    });
    expect(first.status).toBe(202);
    const receipt = (await first.json()) as { id: string; targetType: string; state: string };
    matchesContract(first, receipt, "/v1/brains/{brainId}/sources/{sourceId}", "delete");
    expect(receipt.id).toBe(source.id);
    expect(receipt.targetType).toBe("source");
    const replayed = await request(`/v1/brains/${brainId}/sources/${source.id}`, {
      method: "DELETE",
    });
    expect(replayed.status).toBe(202);
    expect(await replayed.json()).toEqual(receipt);
    const stored = await owner.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM ingest_sources WHERE tenant_id = $1 AND id = $2",
      [tenantA, source.id],
    );
    expect(stored.rows[0]?.deleted_at).toBeInstanceOf(Date);
    const read = await request(`/v1/brains/${brainId}/sources/${source.id}`);
    expect(read.status).toBe(404);
    matchesContract(read, await read.json(), "/v1/brains/{brainId}/sources/{sourceId}", "get");
  });

  test("listing excludes soft-deleted sources and honours pagination", async () => {
    const kept = await capture({ kind: "note", content: "kept", originRef: "list-keep" });
    const removed = await capture({ kind: "note", content: "removed", originRef: "list-drop" });
    expect(kept.status).toBe(201);
    expect(removed.status).toBe(201);
    const keptBody = (await kept.json()) as SourceBody;
    const removedBody = (await removed.json()) as SourceBody;
    const deleted = await request(`/v1/brains/${brainId}/sources/${removedBody.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(202);
    const listed = await request(`/v1/brains/${brainId}/sources?limit=200&offset=0`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as ListBody<SourceBody>;
    matchesContract(listed, body, "/v1/brains/{brainId}/sources", "get");
    const ids = body.items.map((item) => item.id);
    expect(ids).toContain(keptBody.id);
    expect(ids).not.toContain(removedBody.id);
    expect(body.limit).toBe(200);
    expect(body.offset).toBe(0);
    expect(body.total).toBeGreaterThanOrEqual(ids.length);
    const paged = await request(`/v1/brains/${brainId}/sources?limit=1&offset=0`);
    const pagedBody = (await paged.json()) as ListBody<SourceBody>;
    expect(pagedBody.items).toHaveLength(1);
    matchesContract(paged, pagedBody, "/v1/brains/{brainId}/sources", "get");
  });

  test("listing is newest first and offset pagination returns each source once", async () => {
    const brain = await request("/v1/brains", {
      key: keys.get("owner"),
      method: "POST",
      body: { name: "Ordering Brain", slug: `ordering-${crypto.randomUUID()}` },
    });
    expect(brain.status).toBe(201);
    const orderingBrainId = ((await brain.json()) as BrainBody).id;
    const oldest = {
      id: `src_${crypto.randomUUID().replaceAll("-", "")}`,
      content: "oldest",
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    const middle = {
      id: `src_${crypto.randomUUID().replaceAll("-", "")}`,
      content: "middle",
      createdAt: "2026-11-02T00:00:00.000Z",
    };
    const newest = {
      id: `src_${crypto.randomUUID().replaceAll("-", "")}`,
      content: "newest",
      createdAt: "2026-11-03T00:00:00.000Z",
    };
    for (const source of [oldest, middle, newest]) {
      await owner.query(
        `INSERT INTO ingest_sources
           (id, tenant_id, subject_id, brain_id, kind, content, content_hash, created_at)
         VALUES ($1, $2, $3, $4, 'note', $5, $6, $7)`,
        [
          source.id,
          tenantA,
          subjectA,
          orderingBrainId,
          source.content,
          sha256(source.content),
          source.createdAt,
        ],
      );
    }
    const listed = await request(`/v1/brains/${orderingBrainId}/sources`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as ListBody<SourceBody>;
    matchesContract(listed, body, "/v1/brains/{brainId}/sources", "get");
    expect(body.items.map((item) => item.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(body.items.map((item) => item.createdAt)).toEqual([
      newest.createdAt,
      middle.createdAt,
      oldest.createdAt,
    ]);
    const page = await request(`/v1/brains/${orderingBrainId}/sources?limit=2&offset=2`);
    expect(page.status).toBe(200);
    const pageBody = (await page.json()) as ListBody<SourceBody>;
    matchesContract(page, pageBody, "/v1/brains/{brainId}/sources", "get");
    expect(pageBody.items.map((item) => item.id)).toEqual([oldest.id]);
    const firstPage = await request(`/v1/brains/${orderingBrainId}/sources?limit=2&offset=0`);
    const firstPageBody = (await firstPage.json()) as ListBody<SourceBody>;
    expect(firstPageBody.items.map((item) => item.id)).toEqual([newest.id, middle.id]);
    expect(firstPageBody.items.map((item) => item.id)).not.toContain(oldest.id);
  });

  test("an unknown source or brain returns 404 with the envelope", async () => {
    const response = await request(`/v1/brains/${brainId}/sources/src_${"0".repeat(32)}`);
    expect(response.status).toBe(404);
    matchesContract(
      response,
      await response.json(),
      "/v1/brains/{brainId}/sources/{sourceId}",
      "get",
    );
    const brain = await request(`/v1/brains/brn_${"0".repeat(32)}/sources`);
    expect(brain.status).toBe(404);
    matchesContract(brain, await brain.json(), "/v1/brains/{brainId}/sources", "get");
  });

  test("a malformed subject is rejected before any write", async () => {
    const response = await capture({ kind: "note", content: "x" });
    const headers = new Headers({ "x-api-key": keys.get("owner") ?? "", "x-subject-id": "nope" });
    const rejected = await app.handle(
      new Request(`http://localhost/v1/brains/${brainId}/captures`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "note", content: "x" }),
      }),
    );
    expect(rejected.status).toBe(400);
    expect(response.status).toBe(201);
  });
});
