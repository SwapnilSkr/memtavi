import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import type { ExtractedFact } from "@memtavi/core/compile/schemas";
import { createFakeProvider } from "@memtavi/llm/fake";
import { type ChatProvider, ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import type { ObjectBody, ObjectStore } from "@memtavi/storage/types";
import { createWorker } from "@memtavi/worker";
import { compileCapture } from "@memtavi/worker/compile";
import type { CompilerConfig } from "@memtavi/worker/types";
import { Pool } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface SourceBody {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  originalBytes: number;
}

interface PutRecord {
  key: string;
  body: ObjectBody;
}

interface RequestOptions {
  key?: string | undefined;
  subject?: string | null | undefined;
  method?: string;
  body?: unknown;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");
const UNKNOWN_SOURCE = newId("source");

function recordingStore() {
  const inner = createFakeStore();
  const puts: PutRecord[] = [];
  const store: ObjectStore = {
    async put(key, body, contentType) {
      puts.push({ key, body });
      await inner.put(key, body, contentType);
    },
    get: (key) => inner.get(key),
    delete: (key) => inner.delete(key),
    exists: (key) => inner.exists(key),
    signedUrl: (key, ttlSeconds) => inner.signedUrl(key, ttlSeconds),
  };
  return { store, puts };
}

function compilerFor(provider: ReturnType<typeof createFakeProvider>): CompilerConfig {
  const chatProvider: ChatProvider = {
    async chat(request) {
      const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
        chunks?: { chunkUuid: string; text: string }[];
      };
      if (input.chunks) {
        const facts: ExtractedFact[] = input.chunks.map((chunk) => ({
          claim: chunk.text.trim(),
          kind: "project_fact",
          entities: [],
          confidence: 0.9,
          durability: 0.9,
          impact: 0.9,
          recurrence: 0.9,
          novelty: 0.9,
          futureUse: 0.9,
          sensitivity: "none",
          evidence: {
            chunkUuid: chunk.chunkUuid,
            charStart: 0,
            charEnd: chunk.text.length,
            quote: chunk.text,
          },
        }));
        provider.queueChat(JSON.stringify({ facts }));
      }
      return provider.chat(request);
    },
  };
  return {
    chatProvider,
    embeddingProvider: provider,
    chatModel: "fake-chat",
    embeddingModel: "fake-embedding",
  };
}

describe.skipIf(!ownerUrl || !appUrl)("retrying an ingest source", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `retry-a-${crypto.randomUUID()}`;
  const slugB = `retry-b-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const siblingSubject = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const previousAppUrl = process.env.APP_DATABASE_URL;
  const keys = new Map<string, string>();
  let tenantA = "";
  let brainA = "";
  let siblingBrain = "";
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let store: ObjectStore;
  let puts: PutRecord[];
  let fixturesAuthorized = false;

  function request(path: string, options: RequestOptions = {}) {
    const headers = new Headers();
    headers.set("x-api-key", options.key ?? keys.get("a") ?? "");
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subjectA);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  async function createBrain(key: string, subject: string, label: string): Promise<string> {
    const response = await request("/v1/brains", {
      key,
      subject,
      method: "POST",
      body: { name: label, slug: `${label}-${crypto.randomUUID()}` },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  async function capture(
    brainId: string,
    content: string,
    options: { key?: string | undefined; subject?: string | undefined } = {},
  ): Promise<SourceBody> {
    const response = await request(`/v1/brains/${brainId}/captures`, {
      key: options.key ?? keys.get("a"),
      subject: options.subject ?? subjectA,
      method: "POST",
      body: { kind: "note", content },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as SourceBody;
  }

  async function finishIngest(sourceId: string): Promise<void> {
    await owner.query("UPDATE jobs SET status = 'completed' WHERE idempotency_key = $1", [
      `capture:${sourceId}`,
    ]);
  }

  async function fail(sourceId: string, message = "Permanent compiler failure"): Promise<void> {
    await owner.query(
      "UPDATE ingest_sources SET status = 'failed', last_error = $2 WHERE id = $1",
      [sourceId, message],
    );
  }

  function retry(
    brainId: string,
    sourceId: string,
    options: { key?: string | undefined; subject?: string | undefined } = {},
  ) {
    return request(`/v1/brains/${brainId}/sources/${sourceId}/retry`, {
      key: options.key ?? keys.get("a"),
      subject: options.subject ?? subjectA,
      method: "POST",
    });
  }

  async function sourceRow(sourceId: string) {
    return (
      await owner.query<{ row: unknown }>(
        "SELECT to_jsonb(t) AS row FROM ingest_sources t WHERE id = $1",
        [sourceId],
      )
    ).rows[0]?.row;
  }

  async function jobCount(sourceId: string): Promise<number> {
    const result = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM jobs WHERE idempotency_key LIKE $1",
      [`%${sourceId}%`],
    );
    return result.rows[0]?.total ?? 0;
  }

  async function usageCount(): Promise<number> {
    const result = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM usage_ledger WHERE tenant_id = $1",
      [tenantA],
    );
    return result.rows[0]?.total ?? 0;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Source retry fixtures require a disposable memtavi_test database");
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
    keys.set("a", await bootstrap(owner, "Retry A", slugA));
    keys.set("b", await bootstrap(owner, "Retry B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";
    brainA = await createBrain(keys.get("a") ?? "", subjectA, "retry-brain-a");
    siblingBrain = await createBrain(keys.get("a") ?? "", siblingSubject, "retry-brain-a2");
    const viewer = await request("/v1/api-keys", {
      key: keys.get("a"),
      method: "POST",
      body: { name: "Retry viewer", role: "viewer" },
    });
    expect(viewer.status).toBe(201);
    keys.set("viewer", ((await viewer.json()) as { key: string }).key);
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

  beforeEach(() => {
    puts.length = 0;
  });

  test("a failed source returns to pending with one compile job and no new storage", async () => {
    const source = await capture(brainA, "retry this body");
    await finishIngest(source.id);
    await fail(source.id);
    const before = await sourceRow(source.id);
    const usageBefore = await usageCount();
    const putsBefore = puts.length;
    const rowsBefore = (
      await owner.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM ingest_sources WHERE brain_id = $1",
        [brainA],
      )
    ).rows[0]?.total;

    const response = await retry(brainA, source.id);
    const body = (await response.json()) as SourceBody;
    expect(response.status).toBe(202);
    expect(body.id).toBe(source.id);
    expect(body.status).toBe("pending");
    expect(body.attempts).toBe(1);
    expect(body.lastError).toBeNull();
    expect(body.originalBytes).toBe(source.originalBytes);

    const jobs = await owner.query<{
      type: string;
      payload: { sourceId: string; brainId: string };
      max_attempts: number;
    }>(
      `SELECT type, payload, max_attempts FROM jobs
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantA, `retry:${source.id}:1`],
    );
    expect(jobs.rowCount).toBe(1);
    expect(jobs.rows[0]?.type).toBe("capture.compile");
    expect(jobs.rows[0]?.payload).toEqual({ sourceId: source.id, brainId: brainA });
    expect(jobs.rows[0]?.max_attempts).toBe(5);

    const after = await sourceRow(source.id);
    expect(after).toMatchObject({
      ...(before as Record<string, unknown>),
      status: "pending",
      attempts: 1,
      last_error: null,
    });
    expect(puts.length).toBe(putsBefore);
    expect(await usageCount()).toBe(usageBefore);
    expect(
      (
        await owner.query<{ total: number }>(
          "SELECT count(*)::int AS total FROM ingest_sources WHERE brain_id = $1",
          [brainA],
        )
      ).rows[0]?.total,
    ).toBe(rowsBefore);

    await owner.query("UPDATE jobs SET status = 'completed' WHERE idempotency_key = $1", [
      `retry:${source.id}:1`,
    ]);
  });

  test("running the worker with FakeProvider completes the source under the same id", async () => {
    const source = await capture(brainA, "the retried source compiles");
    await finishIngest(source.id);
    await fail(source.id);
    const provider = createFakeProvider();
    const worker = createWorker({
      withTenant: db.withTenant,
      tenantIds: [tenantA],
      store,
      compiler: compilerFor(provider),
      handlers: { "capture.compile": compileCapture },
      random: () => 0,
    });

    expect((await retry(brainA, source.id)).status).toBe(202);
    expect(await worker.runOnce()).toBe(true);

    const row = (
      await owner.query<{
        id: string;
        status: string;
        affected_page_ids: string[];
        compiled_at: Date | null;
      }>("SELECT id, status, affected_page_ids, compiled_at FROM ingest_sources WHERE id = $1", [
        source.id,
      ])
    ).rows[0];
    expect(row?.id).toBe(source.id);
    expect(row?.status).toBe("completed");
    expect(row?.compiled_at).toBeInstanceOf(Date);
    expect(row?.affected_page_ids).toHaveLength(1);
    expect(
      (
        await owner.query<{ total: number }>(
          "SELECT count(*)::int AS total FROM pages WHERE brain_id = $1",
          [brainA],
        )
      ).rows[0]?.total,
    ).toBe(1);
    expect(
      (
        await owner.query<{ status: string }>(
          "SELECT status FROM jobs WHERE idempotency_key = $1",
          [`retry:${source.id}:1`],
        )
      ).rows[0]?.status,
    ).toBe("completed");
  });

  test("a source that has not failed answers 409 and enqueues nothing", async () => {
    const source = await capture(brainA, "still pending");
    const before = await sourceRow(source.id);
    const jobsBefore = await jobCount(source.id);

    const response = await retry(brainA, source.id);
    expect(response.status).toBe(409);

    expect(await sourceRow(source.id)).toEqual(before);
    expect(await jobCount(source.id)).toBe(jobsBefore);
  });

  test("a double POST answers 409 the second time and enqueues one job", async () => {
    const source = await capture(brainA, "double post body");
    await finishIngest(source.id);
    await fail(source.id);

    expect((await retry(brainA, source.id)).status).toBe(202);
    const second = await retry(brainA, source.id);
    expect(second.status).toBe(409);

    const jobs = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM jobs WHERE idempotency_key LIKE $1",
      [`retry:${source.id}:%`],
    );
    expect(jobs.rows[0]?.total).toBe(1);
  });

  test("a viewer cannot retry and the source is unchanged", async () => {
    const source = await capture(brainA, "viewer cannot retry");
    await finishIngest(source.id);
    await fail(source.id);
    const before = await sourceRow(source.id);
    const jobsBefore = await jobCount(source.id);

    const response = await retry(brainA, source.id, { key: keys.get("viewer") });
    expect(response.status).toBe(403);

    expect(await sourceRow(source.id)).toEqual(before);
    expect(await jobCount(source.id)).toBe(jobsBefore);
  });

  test("foreign tenants, foreign subjects and unknown sources answer 404 and change nothing", async () => {
    const own = await capture(brainA, "own failed source");
    await finishIngest(own.id);
    await fail(own.id);
    const ownBefore = await sourceRow(own.id);
    const ownJobs = await jobCount(own.id);

    expect((await retry(brainA, own.id, { key: keys.get("b"), subject: subjectB })).status).toBe(
      404,
    );
    expect(
      (await retry(brainA, own.id, { key: keys.get("a"), subject: siblingSubject })).status,
    ).toBe(404);
    expect(await sourceRow(own.id)).toEqual(ownBefore);
    expect(await jobCount(own.id)).toBe(ownJobs);

    const sibling = await capture(siblingBrain, "sibling failed source", {
      subject: siblingSubject,
    });
    await finishIngest(sibling.id);
    await fail(sibling.id);
    const siblingBefore = await sourceRow(sibling.id);

    expect((await retry(siblingBrain, sibling.id)).status).toBe(404);
    expect(await sourceRow(sibling.id)).toEqual(siblingBefore);

    expect((await retry(brainA, UNKNOWN_SOURCE)).status).toBe(404);

    const deletingBrain = await createBrain(keys.get("a") ?? "", subjectA, "retry-deleting-brain");
    const deleting = await capture(deletingBrain, "source in a deleting brain");
    await finishIngest(deleting.id);
    await fail(deleting.id);
    await owner.query("UPDATE brains SET deletion_state = 'deleting' WHERE id = $1", [
      deletingBrain,
    ]);
    const deletingBefore = await sourceRow(deleting.id);
    expect((await retry(deletingBrain, deleting.id)).status).toBe(404);
    expect(await sourceRow(deleting.id)).toEqual(deletingBefore);
  });

  test("a manual retry during backoff answers 409 and enqueues no second compile", async () => {
    const source = await capture(brainA, "waiting for its own retry");
    await finishIngest(source.id);
    await fail(source.id);
    expect((await retry(brainA, source.id)).status).toBe(202);
    await owner.query(
      `UPDATE jobs SET status = 'completed'
       WHERE tenant_id = $1 AND type = 'capture.compile' AND status = 'pending'
         AND payload->>'sourceId' <> $2`,
      [tenantA, source.id],
    );
    const worker = createWorker({
      withTenant: db.withTenant,
      tenantIds: [tenantA],
      store,
      compiler: {
        chatProvider: {
          chat: async () => {
            throw new ProviderError("rate_limited", true, "private detail", 429);
          },
        },
        embeddingProvider: createFakeProvider(),
        chatModel: "fake-chat",
        embeddingModel: "fake-embedding",
      },
      handlers: { "capture.compile": compileCapture },
      random: () => 0,
    });
    expect(await worker.runOnce()).toBe(true);

    const backoff = await sourceRow(source.id);
    expect(backoff).toMatchObject({
      status: "pending",
      last_error: "Compiler provider failed",
    });
    const compiles = await owner.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM jobs
       WHERE tenant_id = $1 AND type = 'capture.compile' AND payload->>'sourceId' = $2`,
      [tenantA, source.id],
    );
    expect(compiles.rows[0]?.total).toBe(1);

    const response = await retry(brainA, source.id);
    expect(response.status).toBe(409);

    expect(await sourceRow(source.id)).toEqual(backoff);
    const after = await owner.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM jobs
       WHERE tenant_id = $1 AND type = 'capture.compile' AND payload->>'sourceId' = $2`,
      [tenantA, source.id],
    );
    expect(after.rows[0]?.total).toBe(1);
  });
});
