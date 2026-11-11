import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ExtractedFact } from "@memtavi/core/compile/schemas";
import { createFakeProvider, type FakeProvider } from "@memtavi/llm/fake";
import { ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { chunkKey, contentHash } from "@memtavi/storage/keys";
import { createWorker } from "@memtavi/worker";
import { compileCapture } from "@memtavi/worker/compile";
import type { CompilerConfig } from "@memtavi/worker/types";
import { Pool, type PoolClient } from "pg";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const chatModel = "fake-chat";
const embeddingModel = "fake-embedding";

interface Counts {
  pages: number;
  versions: number;
  pageSources: number;
  embeddings: number;
  changeEvents: number;
  changeOutbox: number;
  webhookDeliveries: number;
  deliveryJobs: number;
  chunks: number;
  ledger: number;
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("expected a row");
  return value;
}

function asUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

describe("provider failure drills", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const store = createFakeStore();
  const tenantId = crypto.randomUUID();
  const subjectId = crypto.randomUUID();
  let brainId = "";
  let webhookId = "";
  let authorized = false;

  async function withTenant<T>(
    tenant: string,
    callback: (client: PoolClient) => Promise<T>,
    subject?: string,
  ): Promise<T> {
    const client = await application.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      if (subject) await client.query("SELECT set_config('app.subject_id', $1, true)", [subject]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  function compilerFor(provider: FakeProvider): CompilerConfig {
    return {
      chatModel,
      embeddingModel,
      chatProvider: provider,
      embeddingProvider: provider,
    };
  }

  function workerFor(provider: FakeProvider) {
    return createWorker({
      withTenant,
      tenantIds: [tenantId],
      store,
      compiler: compilerFor(provider),
      handlers: { "capture.compile": compileCapture },
      random: () => 0,
    });
  }

  function chunkUuidFor(sourceId: string, text: string, ordinal = 0): string {
    const bodyRef = chunkKey({ tenantId, sourceId, body: text, ordinal });
    return asUuid(contentHash(bodyRef).slice(0, 32));
  }

  function extractionResponse(sourceId: string, text: string): string {
    const facts: ExtractedFact[] = [
      {
        claim: text,
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
          chunkUuid: chunkUuidFor(sourceId, text),
          charStart: 0,
          charEnd: text.length,
          quote: text,
        },
      },
    ];
    return JSON.stringify({ facts });
  }

  function patchResponse(summary: string): string {
    return JSON.stringify({
      title: "Updated",
      summary,
      body: "Updated body",
      changed: true,
      contradictions: [],
    });
  }

  async function capture(
    text: string,
    maxAttempts = 5,
  ): Promise<{ sourceId: string; jobId: string }> {
    const sourceId = newId("source");
    await owner.query(
      `INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
       VALUES ($1, $2, $3, $4, 'note', $5, $6)`,
      [sourceId, tenantId, subjectId, brainId, text, contentHash(text)],
    );
    const job = await owner.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
       VALUES ($1, $2, 'capture.compile', $3, $4, $5) RETURNING id`,
      [
        tenantId,
        brainId,
        JSON.stringify({ sourceId, brainId }),
        `compile:${sourceId}`,
        maxAttempts,
      ],
    );
    return { sourceId, jobId: first(job.rows).id };
  }

  async function seedCandidate(text: string): Promise<string> {
    const pageId = newId("page");
    const vector = first((await createFakeProvider().embed([text])).vectors);
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, summary, body, content_hash)
       VALUES ($1, $2, $3, $4, 'target', 'Original', 'Old summary', 'Human body', $5)`,
      [pageId, tenantId, subjectId, brainId, contentHash("Original\nOld summary\nHuman body")],
    );
    await owner.query(
      `INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor)
       VALUES ($1, $2, 1, 'Original', 'Old summary', 'Human body', 'user')`,
      [tenantId, pageId],
    );
    await owner.query(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       SELECT tenant_id, id, $3, 1536, $4::vector, content_hash FROM pages
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, pageId, embeddingModel, JSON.stringify(vector)],
    );
    return pageId;
  }

  async function pageRows(pageId?: string) {
    const result = await owner.query<Record<string, unknown>>(
      `SELECT * FROM pages WHERE tenant_id = $1 AND brain_id = $2
       ${pageId ? "AND id = $3" : ""} ORDER BY id`,
      pageId ? [tenantId, brainId, pageId] : [tenantId, brainId],
    );
    return result.rows;
  }

  async function counts(jobId: string): Promise<Counts> {
    const result = await owner.query<Counts>(
      `SELECT
       (SELECT count(*)::int FROM pages WHERE tenant_id = $1 AND brain_id = $2) AS "pages",
       (SELECT count(*)::int FROM page_versions v JOIN pages p ON p.id = v.page_id
         WHERE v.tenant_id = $1 AND p.brain_id = $2) AS "versions",
       (SELECT count(*)::int FROM page_sources WHERE tenant_id = $1
         AND page_id IN (SELECT id FROM pages WHERE tenant_id = $1 AND brain_id = $2))
         AS "pageSources",
       (SELECT count(*)::int FROM page_embeddings e JOIN pages p ON p.id = e.page_id
         WHERE e.tenant_id = $1 AND p.brain_id = $2) AS "embeddings",
       (SELECT count(*)::int FROM change_events WHERE tenant_id = $1 AND brain_id = $2)
         AS "changeEvents",
       (SELECT count(*)::int FROM webhook_events WHERE tenant_id = $1 AND brain_id = $2
         AND kind = 'change') AS "changeOutbox",
       (SELECT count(*)::int FROM webhook_deliveries WHERE tenant_id = $1) AS "webhookDeliveries",
       (SELECT count(*)::int FROM jobs WHERE tenant_id = $1 AND brain_id = $2
         AND type = 'webhook.deliver') AS "deliveryJobs",
       (SELECT count(*)::int FROM source_chunks WHERE tenant_id = $1 AND brain_id = $2)
         AS "chunks",
       (SELECT count(*)::int FROM usage_ledger WHERE tenant_id = $1 AND job_id = $3) AS "ledger"`,
      [tenantId, brainId, jobId],
    );
    return first(result.rows);
  }

  async function jobRow(jobId: string) {
    return first(
      (
        await owner.query<{
          status: string;
          attempts: number;
          max_attempts: number;
          last_error: string | null;
          available_at: Date;
          lease_until: Date | null;
        }>(
          `SELECT status, attempts, max_attempts, last_error, available_at, lease_until
           FROM jobs WHERE tenant_id = $1 AND id = $2`,
          [tenantId, jobId],
        )
      ).rows,
    );
  }

  async function sourceRow(sourceId: string) {
    return first(
      (
        await owner.query<{ status: string; last_error: string | null; compiled_at: Date | null }>(
          `SELECT status, last_error, compiled_at FROM ingest_sources
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, sourceId],
        )
      ).rows,
    );
  }

  async function backoffSeconds(jobId: string): Promise<number> {
    const result = await owner.query<{ seconds: number }>(
      `SELECT extract(epoch FROM available_at - now())::float8 AS seconds
       FROM jobs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, jobId],
    );
    return first(result.rows).seconds;
  }

  async function advanceClock(jobId: string): Promise<void> {
    await owner.query("UPDATE jobs SET available_at = now() WHERE tenant_id = $1 AND id = $2", [
      tenantId,
      jobId,
    ]);
  }

  async function expectUsageBounded(jobId: string, provider: FakeProvider): Promise<void> {
    const ledger = await counts(jobId);
    expect(ledger.ledger).toBeLessThanOrEqual(provider.calls.length);
    const rows = await owner.query<{ input_tokens: number; cost_usd: string }>(
      "SELECT input_tokens, cost_usd FROM usage_ledger WHERE tenant_id = $1 AND job_id = $2",
      [tenantId, jobId],
    );
    for (const row of rows.rows) {
      expect(row.input_tokens).toBeGreaterThan(0);
      expect(Number(row.cost_usd)).toBeGreaterThanOrEqual(0);
    }
  }

  beforeAll(async () => {
    if (!ownerUrl || !appUrl) throw new Error("Both test database URLs are required");
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(first(database.rows).name)) {
      throw new Error("Provider drills require a disposable memtavi_test database");
    }
    const role = await application.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(first(role.rows)).toEqual({ rolsuper: false, rolbypassrls: false });
    authorized = true;
    await owner.query(
      "INSERT INTO tenants (id, name, slug) VALUES ($1::uuid, 'Drills', $1::uuid::text)",
      [tenantId],
    );
    await owner.query("INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1, $2)", [
      tenantId,
      subjectId,
    ]);
  });

  beforeEach(async () => {
    brainId = newId("brain");
    await owner.query(
      "INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, 'Drills', $1)",
      [brainId, tenantId, subjectId],
    );
    await owner.query("DELETE FROM webhooks WHERE tenant_id = $1", [tenantId]);
    webhookId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO webhooks (id, tenant_id, subject_id, url, events, secret_enc)
       VALUES ($1, $2, $3, 'https://example.com/hook', ARRAY['brain.page.updated'], 'unused')`,
      [webhookId, tenantId, subjectId],
    );
  });

  afterAll(async () => {
    if (authorized) await owner.query("DELETE FROM tenants WHERE id = $1::uuid", [tenantId]);
    await Promise.all([owner.end(), application.end()]);
  });

  test("a 429 at extraction retries with backoff and the next attempt writes one set of pages", async () => {
    const note = "The compiler preserves evidence.";
    const { sourceId, jobId } = await capture(note);
    const provider = createFakeProvider();
    provider.queueChat(
      new ProviderError("rate_limited", true, "provider said 429", 429),
      extractionResponse(sourceId, note),
    );
    const worker = workerFor(provider);

    expect(await worker.runOnce()).toBe(true);
    const failed = await jobRow(jobId);
    expect(failed).toMatchObject({
      status: "pending",
      attempts: 1,
      last_error: "Compiler provider failed",
      lease_until: null,
    });
    const delay = await backoffSeconds(jobId);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(3);
    expect(await sourceRow(sourceId)).toMatchObject({
      status: "pending",
      last_error: "Compiler provider failed",
    });
    expect(await counts(jobId)).toEqual({
      pages: 0,
      versions: 0,
      pageSources: 0,
      embeddings: 0,
      changeEvents: 0,
      changeOutbox: 0,
      webhookDeliveries: 0,
      deliveryJobs: 0,
      chunks: 0,
      ledger: 0,
    });

    await advanceClock(jobId);
    expect(await worker.runOnce()).toBe(true);
    expect(await jobRow(jobId)).toMatchObject({
      status: "completed",
      attempts: 2,
      last_error: null,
      lease_until: null,
    });
    expect(await sourceRow(sourceId)).toMatchObject({ status: "completed", last_error: null });
    expect(await counts(jobId)).toEqual({
      pages: 1,
      versions: 1,
      pageSources: 1,
      embeddings: 1,
      changeEvents: 1,
      changeOutbox: 1,
      webhookDeliveries: 0,
      deliveryJobs: 1,
      chunks: 1,
      ledger: 3,
    });
    expect(first(await pageRows()).version).toBe(1);
    expect(provider.calls.length).toBeGreaterThanOrEqual(3);
    await expectUsageBounded(jobId, provider);
  });

  test("a timeout at the patch call leaves nothing partial and the retry completes the page", async () => {
    const note = "The compiler preserves evidence.";
    const pageId = await seedCandidate(note);
    const before = await pageRows(pageId);
    const { sourceId, jobId } = await capture(note);
    const provider = createFakeProvider();
    provider.queueChat(
      extractionResponse(sourceId, note),
      new ProviderError("timeout", true, "provider timed out"),
    );
    const worker = workerFor(provider);

    const seeded = await counts(jobId);
    expect(seeded).toMatchObject({ pages: 1, versions: 1, embeddings: 1, changeEvents: 0 });

    expect(await worker.runOnce()).toBe(true);
    expect(await jobRow(jobId)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await backoffSeconds(jobId)).toBeGreaterThan(0);
    expect(await sourceRow(sourceId)).toMatchObject({
      status: "pending",
      last_error: "Compiler provider failed",
    });
    expect(await pageRows(pageId)).toEqual(before);
    expect(await counts(jobId)).toEqual({
      ...seeded,
      ledger: 2,
    });

    provider.queueChat(extractionResponse(sourceId, note), patchResponse(note));
    await advanceClock(jobId);
    expect(await worker.runOnce()).toBe(true);
    expect(await jobRow(jobId)).toMatchObject({ status: "completed", attempts: 2 });
    expect(await sourceRow(sourceId)).toMatchObject({ status: "completed" });
    const page = first(await pageRows(pageId));
    expect(page).toMatchObject({
      title: "Updated",
      version: 2,
      body: expect.stringContaining("Updated body"),
    });
    const actual = await counts(jobId);
    expect(actual).toEqual({
      pages: 1,
      versions: 2,
      pageSources: 1,
      embeddings: 1,
      changeEvents: 1,
      changeOutbox: 1,
      webhookDeliveries: 0,
      deliveryJobs: 1,
      chunks: 1,
      ledger: 6,
    });
    expect(provider.calls.length).toBeGreaterThanOrEqual(6);
    await expectUsageBounded(jobId, provider);
  });

  test("a server error at the page embedding rolls the patch back and the retry completes", async () => {
    const note = "The compiler preserves evidence.";
    const pageId = await seedCandidate(note);
    const before = await pageRows(pageId);
    const { sourceId, jobId } = await capture(note);
    const provider = createFakeProvider();
    provider.queueChat(extractionResponse(sourceId, note), patchResponse(note));
    provider.queueEmbed("ok", new ProviderError("server_error", true, "upstream 500", 500));
    const worker = workerFor(provider);

    const seeded = await counts(jobId);
    expect(await worker.runOnce()).toBe(true);
    expect(await jobRow(jobId)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await backoffSeconds(jobId)).toBeGreaterThan(0);
    expect(await sourceRow(sourceId)).toMatchObject({
      status: "pending",
      last_error: "Compiler provider failed",
    });
    expect(await pageRows(pageId)).toEqual(before);
    expect(await counts(jobId)).toEqual({ ...seeded, ledger: 3 });

    provider.queueChat(extractionResponse(sourceId, note), patchResponse(note));
    provider.queueEmbed("ok", "ok");
    await advanceClock(jobId);
    expect(await worker.runOnce()).toBe(true);
    expect(await jobRow(jobId)).toMatchObject({ status: "completed", attempts: 2 });
    expect(first(await pageRows(pageId))).toMatchObject({ version: 2 });
    expect(await counts(jobId)).toEqual({
      pages: 1,
      versions: 2,
      pageSources: 1,
      embeddings: 1,
      changeEvents: 1,
      changeOutbox: 1,
      webhookDeliveries: 0,
      deliveryJobs: 1,
      chunks: 1,
      ledger: 7,
    });
    await expectUsageBounded(jobId, provider);
  });

  test("malformed extraction output is permanent: dead job, failed source, no retry", async () => {
    const note = "The compiler preserves evidence.";
    const { sourceId, jobId } = await capture(note);
    const provider = createFakeProvider();
    provider.queueChat('{"facts":[{"claim":');
    const worker = workerFor(provider);

    expect(await worker.runOnce()).toBe(true);
    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      status: "dead",
      attempts: 1,
      last_error: "Invalid compiler output",
      lease_until: null,
    });
    expect(await backoffSeconds(jobId)).toBeLessThanOrEqual(0);
    expect(await sourceRow(sourceId)).toMatchObject({
      status: "failed",
      last_error: "Invalid compiler output",
      compiled_at: null,
    });
    expect(await counts(jobId)).toEqual({
      pages: 0,
      versions: 0,
      pageSources: 0,
      embeddings: 0,
      changeEvents: 0,
      changeOutbox: 0,
      webhookDeliveries: 0,
      deliveryJobs: 0,
      chunks: 0,
      ledger: 1,
    });
    expect(await worker.runOnce()).toBe(false);
    expect(await jobRow(jobId)).toMatchObject({ status: "dead" });
    await expectUsageBounded(jobId, provider);
  });

  test("a transient failure that never clears is dead-lettered after max_attempts", async () => {
    const note = "The compiler preserves evidence.";
    const { sourceId, jobId } = await capture(note, 2);
    const provider = createFakeProvider();
    provider.queueChat(
      new ProviderError("network", true, "connection reset"),
      new ProviderError("network", true, "connection reset"),
    );
    const worker = workerFor(provider);

    expect(await worker.runOnce()).toBe(true);
    expect(await jobRow(jobId)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await backoffSeconds(jobId)).toBeGreaterThan(0);
    expect(await sourceRow(sourceId)).toMatchObject({
      status: "pending",
      last_error: "Compiler provider failed",
    });

    await advanceClock(jobId);
    expect(await worker.runOnce()).toBe(true);
    const dead = await jobRow(jobId);
    expect(dead).toMatchObject({ status: "dead", attempts: 2, max_attempts: 2, lease_until: null });
    expect(dead.last_error).toBe("Compiler provider failed");
    expect(await sourceRow(sourceId)).toMatchObject({
      status: "failed",
      last_error: "Compiler provider failed",
    });
    expect(await counts(jobId)).toEqual({
      pages: 0,
      versions: 0,
      pageSources: 0,
      embeddings: 0,
      changeEvents: 0,
      changeOutbox: 0,
      webhookDeliveries: 0,
      deliveryJobs: 0,
      chunks: 0,
      ledger: 0,
    });
    expect(await worker.runOnce()).toBe(false);
    expect(await jobRow(jobId)).toMatchObject({ status: "dead" });
    await expectUsageBounded(jobId, provider);
  });
});
