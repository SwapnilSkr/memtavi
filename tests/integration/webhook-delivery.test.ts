import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import type { ExtractedFact } from "@memtavi/core/compile/schemas";
import { FetchError, type FetchedDocument } from "@memtavi/fetch";
import { createFakeProvider } from "@memtavi/llm/fake";
import type { ChatRequest } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { signWebhookPayload } from "@memtavi/shared/webhooks";
import { createFakeStore } from "@memtavi/storage/fake";
import { contentHash } from "@memtavi/storage/keys";
import { createWorker } from "@memtavi/worker";
import { compileCapture } from "@memtavi/worker/compile";
import type { CompilerConfig, JobHandler, PostJson } from "@memtavi/worker/types";
import { deliverWebhook } from "@memtavi/worker/webhook";
import { Pool } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface CreatedWebhook {
  id: string;
  secret: string;
  events: string[];
}

interface JobRow {
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
}

interface DeliveryRow {
  id: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  payload: Record<string, unknown>;
}

interface PostCall {
  url: string;
  body: string;
  headers: Record<string, string>;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");
const testKey = Buffer.alloc(32, 5).toString("base64");
const hookUrl = "https://hooks.example.com/memtavi";

describe.skipIf(!ownerUrl || !appUrl)("webhook delivery", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const store = createFakeStore();
  const slug = `delivery-${crypto.randomUUID()}`;
  const subjectId = crypto.randomUUID();
  const previousAppUrl = process.env.APP_DATABASE_URL;
  let tenantId = "";
  let brainId = "";
  let apiKey = "";
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let fixturesAuthorized = false;
  let postCalls: PostCall[] = [];
  let respond: (call: PostCall) => FetchedDocument = () => ({
    status: 200,
    finalUrl: hookUrl,
    contentType: "application/json",
    text: "",
  });

  const fakePost: PostJson = async (url, body, headers) => {
    const call = { url, body, headers };
    postCalls.push(call);
    return respond(call);
  };

  function makeWorker(options: {
    handlers?: Record<string, JobHandler>;
    compiler?: CompilerConfig;
    secretKey?: string | null;
  }) {
    const key = options.secretKey === undefined ? testKey : options.secretKey;
    return createWorker({
      withTenant: db.withTenant,
      tenantIds: [tenantId],
      store,
      handlers: options.handlers ?? { "webhook.deliver": deliverWebhook },
      postJson: fakePost,
      random: () => 0,
      log: () => undefined,
      ...(options.compiler === undefined ? {} : { compiler: options.compiler }),
      ...(key === null ? {} : { webhookSecretKey: key }),
    });
  }

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

  async function createWebhook(events: string[]): Promise<CreatedWebhook> {
    const response = await request("/v1/webhooks", {
      method: "POST",
      body: { url: hookUrl, events },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as CreatedWebhook;
  }

  async function seedPage(): Promise<string> {
    const id = newId("page");
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash)
       VALUES ($1, $2, $3, $4, $5, 'Delivery target', $6)`,
      [id, tenantId, subjectId, brainId, `target-${crypto.randomUUID()}`, contentHash(id)],
    );
    return id;
  }

  async function seedEvent(pageId: string, action = "created"): Promise<string> {
    const id = newId("change");
    await owner.query(
      `INSERT INTO change_events
       (id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version)
       VALUES ($1, $2, $3, $4, $5, 'Something changed', NULL, 1)`,
      [id, tenantId, brainId, pageId, action],
    );
    return id;
  }

  async function queueDelivery(webhookId: string, eventId: string): Promise<string> {
    const result = await owner.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
       VALUES ($1, $2, 'webhook.deliver', $3, $4, 5) RETURNING id`,
      [
        tenantId,
        brainId,
        JSON.stringify({ webhookId, eventId }),
        `webhook:${eventId}:${webhookId}`,
      ],
    );
    return result.rows[0]?.id ?? "";
  }

  async function deliveries(eventId: string): Promise<DeliveryRow[]> {
    const result = await owner.query<DeliveryRow>(
      `SELECT id, status, attempts, response_status AS "responseStatus",
         last_error AS "lastError", payload
       FROM webhook_deliveries WHERE tenant_id = $1 AND event_id = $2 ORDER BY id`,
      [tenantId, eventId],
    );
    return result.rows;
  }

  async function jobRow(id: string): Promise<JobRow> {
    const result = await owner.query<JobRow>(
      `SELECT status, attempts, max_attempts, last_error FROM jobs WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Job row missing");
    return row;
  }

  function compiler(): CompilerConfig {
    const provider = createFakeProvider();
    return {
      chatModel: "fake-chat",
      embeddingModel: "fake-embedding",
      chatProvider: {
        chat: async (request: ChatRequest) => {
          const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
            chunks?: { chunkUuid: string; text: string }[];
          };
          if (input.chunks) {
            const facts = input.chunks.map(
              (chunk): ExtractedFact => ({
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
              }),
            );
            provider.queueChat(JSON.stringify({ facts }));
          }
          return provider.chat(request);
        },
      },
      embeddingProvider: {
        embed: async (texts) => provider.embed(texts),
      },
    };
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Webhook delivery fixtures require a disposable memtavi_test database");
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
      store,
      now: () => fixedNow,
      webhookSecretKey: testKey,
    });
    apiKey = await bootstrap(owner, "Webhook Delivery", slug);
    const tenant = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [
      slug,
    ]);
    tenantId = tenant.rows[0]?.id ?? "";
    const brain = await request("/v1/brains", {
      method: "POST",
      body: { name: "Delivery Brain", slug: `brain-${crypto.randomUUID()}` },
    });
    expect(brain.status).toBe(201);
    brainId = ((await brain.json()) as { id: string }).id;
  });

  beforeEach(async () => {
    postCalls = [];
    respond = () => ({
      status: 200,
      finalUrl: hookUrl,
      contentType: "application/json",
      text: "",
    });
    await owner.query("DELETE FROM jobs WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM webhooks WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM ingest_sources WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM pages WHERE tenant_id = $1", [tenantId]);
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
    await owner.end();
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  });

  test("delivers a matching change with the documented payload, headers and signature", async () => {
    const hook = await createWebhook(["created"]);
    const pageId = await seedPage();
    const eventId = await seedEvent(pageId, "created");
    const jobId = await queueDelivery(hook.id, eventId);

    expect(await makeWorker({}).runOnce()).toBe(true);

    expect(await jobRow(jobId)).toMatchObject({ status: "completed", attempts: 1 });
    const rows = await deliveries(eventId);
    expect(rows).toHaveLength(1);
    const delivery = rows[0];
    if (!delivery) throw new Error("Delivery row missing");
    expect(delivery).toMatchObject({
      status: "delivered",
      responseStatus: 200,
      attempts: 1,
      lastError: null,
    });

    expect(postCalls).toHaveLength(1);
    const call = postCalls[0];
    if (!call) throw new Error("Post call missing");
    expect(call.url).toBe(hookUrl);
    const payload = JSON.parse(call.body) as Record<string, unknown>;
    expect(payload).toEqual({
      deliveryId: delivery.id,
      eventId,
      type: "created",
      brainId,
      pageId,
      changeSummary: "Something changed",
      fromVersion: null,
      toVersion: 1,
      createdAt: expect.any(String),
    });
    expect(delivery.payload).toEqual(payload);
    expect(call.headers["x-memtavi-event"]).toBe("created");
    expect(call.headers["x-memtavi-delivery"]).toBe(delivery.id);
    expect(call.headers["x-memtavi-signature"]).toBe(
      `sha256=${signWebhookPayload(hook.secret, call.body)}`,
    );
  });

  test("records a failed attempt and resumes the same delivery on retry", async () => {
    const hook = await createWebhook(["created"]);
    const pageId = await seedPage();
    const eventId = await seedEvent(pageId, "created");
    const jobId = await queueDelivery(hook.id, eventId);

    respond = () => ({ status: 503, finalUrl: hookUrl, contentType: null, text: "" });
    expect(await makeWorker({}).runOnce()).toBe(true);

    const failed = await deliveries(eventId);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: "failed", responseStatus: 503, attempts: 1 });
    expect(await jobRow(jobId)).toMatchObject({ status: "pending", attempts: 1 });

    await owner.query("UPDATE jobs SET available_at = now() WHERE id = $1", [jobId]);
    respond = () => ({ status: 204, finalUrl: hookUrl, contentType: null, text: "" });
    expect(await makeWorker({}).runOnce()).toBe(true);

    const delivered = await deliveries(eventId);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      status: "delivered",
      responseStatus: 204,
      attempts: 2,
      lastError: null,
    });
    expect(delivered[0]?.id).toBe(failed[0]?.id);
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0]?.body).toBe(postCalls[1]?.body);
    const second = postCalls[1];
    if (!second) throw new Error("Second post call missing");
    expect(second.headers["x-memtavi-signature"]).toBe(
      `sha256=${signWebhookPayload(hook.secret, second.body)}`,
    );
  });

  test("a non-retryable status kills the delivery and the job", async () => {
    const hook = await createWebhook(["created"]);
    const pageId = await seedPage();
    const eventId = await seedEvent(pageId, "created");
    const jobId = await queueDelivery(hook.id, eventId);

    respond = () => ({ status: 410, finalUrl: hookUrl, contentType: null, text: "" });
    expect(await makeWorker({}).runOnce()).toBe(true);

    expect((await deliveries(eventId))[0]).toMatchObject({
      status: "dead",
      responseStatus: 410,
      attempts: 1,
      lastError: "Webhook endpoint returned 410",
    });
    expect(await jobRow(jobId)).toMatchObject({ status: "dead", attempts: 1 });
  });

  test("a network failure is transient and retried", async () => {
    const hook = await createWebhook(["created"]);
    const pageId = await seedPage();
    const eventId = await seedEvent(pageId, "created");
    const jobId = await queueDelivery(hook.id, eventId);

    respond = () => {
      throw new FetchError("network", true, "Fetch failed");
    };
    expect(await makeWorker({}).runOnce()).toBe(true);

    expect((await deliveries(eventId))[0]).toMatchObject({
      status: "failed",
      responseStatus: null,
      attempts: 1,
      lastError: "Fetch failed",
    });
    expect(await jobRow(jobId)).toMatchObject({ status: "pending", attempts: 1 });
  });

  test("an inactive webhook is a no-op", async () => {
    const hook = await createWebhook(["created"]);
    await owner.query("UPDATE webhooks SET active = false WHERE id = $1", [hook.id]);
    const pageId = await seedPage();
    const eventId = await seedEvent(pageId, "created");
    const jobId = await queueDelivery(hook.id, eventId);

    expect(await makeWorker({}).runOnce()).toBe(true);

    expect(await deliveries(eventId)).toHaveLength(0);
    expect(postCalls).toHaveLength(0);
    expect(await jobRow(jobId)).toMatchObject({ status: "completed", attempts: 1 });
  });

  test("a missing change event is a no-op", async () => {
    const hook = await createWebhook(["created"]);
    const eventId = newId("change");
    const jobId = await queueDelivery(hook.id, eventId);

    expect(await makeWorker({}).runOnce()).toBe(true);

    expect(await deliveries(eventId)).toHaveLength(0);
    expect(postCalls).toHaveLength(0);
    expect(await jobRow(jobId)).toMatchObject({ status: "completed", attempts: 1 });
  });

  test("a delivery without a configured key fails permanently without posting", async () => {
    const hook = await createWebhook(["created"]);
    const pageId = await seedPage();
    const eventId = await seedEvent(pageId, "created");
    const jobId = await queueDelivery(hook.id, eventId);

    expect(await makeWorker({ secretKey: null }).runOnce()).toBe(true);

    const row = (await deliveries(eventId))[0];
    if (!row) throw new Error("Delivery row missing");
    expect(row).toMatchObject({
      status: "dead",
      attempts: 1,
      lastError: "Webhook signing is not configured on this server",
    });
    expect(postCalls).toHaveLength(0);
    expect(JSON.stringify(row)).not.toContain(hook.secret);
    expect(await jobRow(jobId)).toMatchObject({ status: "dead", attempts: 1 });
  });

  test("compiling a source enqueues one delivery per matching active webhook", async () => {
    const matching = await createWebhook(["created"]);
    await createWebhook(["updated"]);
    const inactive = await createWebhook(["created"]);
    await owner.query("UPDATE webhooks SET active = false WHERE id = $1", [inactive.id]);

    const sourceId = newId("source");
    const note = "The delivery enqueue fires when a new page is created.";
    await owner.query(
      `INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
       VALUES ($1, $2, $3, $4, 'note', $5, $6)`,
      [sourceId, tenantId, subjectId, brainId, note, contentHash(note)],
    );
    const compileJob = await owner.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
       VALUES ($1, $2, 'capture.compile', $3, $4, 5) RETURNING id`,
      [tenantId, brainId, JSON.stringify({ sourceId, brainId }), `compile:${sourceId}`],
    );
    expect(compileJob.rows[0]?.id).toBeTruthy();

    const compileWorker = makeWorker({
      handlers: { "capture.compile": compileCapture },
      compiler: compiler(),
    });
    expect(await compileWorker.runOnce()).toBe(true);

    const events = await owner.query<{ id: string }>(
      `SELECT id FROM change_events WHERE tenant_id = $1 AND ingest_source_id = $2`,
      [tenantId, sourceId],
    );
    expect(events.rows).toHaveLength(1);
    const eventId = events.rows[0]?.id;

    const enqueued = await owner.query<{
      payload: Record<string, unknown>;
      idempotency_key: string;
      max_attempts: number;
      status: string;
    }>(
      `SELECT payload, idempotency_key, max_attempts, status FROM jobs
       WHERE tenant_id = $1 AND type = 'webhook.deliver'`,
      [tenantId],
    );
    expect(enqueued.rows).toHaveLength(1);
    expect(enqueued.rows[0]).toEqual({
      payload: { webhookId: matching.id, eventId },
      idempotency_key: `webhook:${eventId}:${matching.id}`,
      max_attempts: 5,
      status: "pending",
    });
  });
});
