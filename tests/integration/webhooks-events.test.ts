import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createFakeProvider } from "@memtavi/llm/fake";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { createWorker } from "@memtavi/worker";
import { compileCapture } from "@memtavi/worker/compile";
import { deliverWebhook } from "@memtavi/worker/webhook";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { createHarness, type Harness, WEBHOOK_SECRET_KEY } from "../support/harness";

const spec = parse(
  await Bun.file(new URL("../../packages/spec/openapi.yaml", import.meta.url)).text(),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile({
  ...spec.components.schemas.WebhookPayload,
  components: spec.components,
});
const actions = [
  "created",
  "updated",
  "renamed",
  "merged",
  "split",
  "archived",
  "restored",
  "recovered",
  "routed",
];

interface Receipt {
  body: string;
  headers: Headers;
}

describe("PRD webhook event deliveries", () => {
  let h: Harness;
  let db: typeof import("@memtavi/db/client");
  let brainId: string;
  let server: ReturnType<typeof Bun.serve>;
  let receipts: Receipt[];
  let responseStatus: number;

  beforeEach(async () => {
    h = await createHarness();
    db = await import("@memtavi/db/client");
    const response = await h.request("/v1/brains", {
      method: "POST",
      body: { name: "Events", slug: "events" },
    });
    expect(response.status).toBe(201);
    brainId = ((await response.json()) as { id: string }).id;
    receipts = [];
    responseStatus = 204;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        receipts.push({ body: await request.text(), headers: request.headers });
        return new Response(null, { status: responseStatus });
      },
    });
  });

  afterEach(async () => {
    server?.stop(true);
    await h?.close();
  });

  async function hook(events: string[]) {
    const response = await h.request("/v1/webhooks", {
      method: "POST",
      body: { url: "https://subscriber.example/events", events },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; secret: string };
  }

  async function page() {
    const id = newId("page");
    await h.owner.query(
      "INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash) VALUES ($1, $2, $3, $4, $1, 'Events', 'hash')",
      [id, h.tenants.a, h.subjects.a, brainId],
    );
    return id;
  }

  async function change(action: string, pageId: string) {
    const id = newId("change");
    await db.withTenant(h.tenants.a, (client) =>
      client.query(
        "INSERT INTO change_events (id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version) VALUES ($1, $2, $3, $4, $5, 'Changed', NULL, 1)",
        [id, h.tenants.a, brainId, pageId, action],
      ),
    );
    return id;
  }

  function worker(chat = '{"facts":[]}') {
    const provider = createFakeProvider();
    provider.queueChat(chat);
    return createWorker({
      withTenant: db.withTenant,
      tenantIds: [h.tenants.a],
      store: createFakeStore(),
      handlers: { "capture.compile": compileCapture, "webhook.deliver": deliverWebhook },
      compiler: {
        chatModel: "fake-chat",
        embeddingModel: "fake-embedding",
        chatProvider: provider,
        embeddingProvider: provider,
      },
      webhookSecretKey: WEBHOOK_SECRET_KEY,
      postJson: async (_url, body, headers) => {
        const response = await fetch(server.url, { method: "POST", body, headers });
        return {
          status: response.status,
          finalUrl: "https://subscriber.example/events",
          contentType: null,
          text: await response.text(),
        };
      },
      random: () => 0,
    });
  }

  async function drain(instance = worker()) {
    for (let i = 0; i < 20; i += 1) {
      if (!(await instance.runOnce())) return;
    }
    throw new Error("Webhook queue did not drain within 20 claims");
  }

  function signed(secret: string, type: string, index = 0) {
    const receipt = receipts[index];
    if (!receipt) throw new Error("Missing local receiver delivery");
    const payload = JSON.parse(receipt.body) as Record<string, unknown>;
    expect(validate(payload)).toBe(true);
    expect(receipt.headers.get("x-memtavi-signature")).toBe(
      `sha256=${createHmac("sha256", secret).update(receipt.body).digest("hex")}`,
    );
    expect(receipt.headers.get("x-memtavi-event")).toBe(type);
    expect(receipt.headers.get("x-memtavi-delivery")).toBe(String(payload.deliveryId));
    expect(payload.type).toBe(type);
    expect(payload.brainId).toBe(brainId);
    return payload;
  }

  test.each(["brain.page.updated", "brain.change.new"])(
    "%s delivers every page content or status action with its documented signed shape",
    async (type) => {
      const subscription = await hook([type]);
      const pageId = await page();
      for (const action of actions) {
        const eventId = await change(action, pageId);
        await drain();
        const payload = signed(subscription.secret, type, receipts.length - 1);
        expect(payload).toMatchObject({
          eventId,
          action,
          pageId,
          changeSummary: "Changed",
          fromVersion: null,
          toVersion: 1,
        });
      }
      expect(receipts).toHaveLength(actions.length);
    },
  );

  test.each(actions)(
    "a raw %s subscription preserves its payload and wins an overlapping subscription once",
    async (action) => {
      const subscription = await hook([action, "brain.page.updated", "brain.change.new"]);
      const eventId = await change(action, await page());
      await drain();
      expect(receipts).toHaveLength(1);
      const payload = signed(subscription.secret, action);
      expect(payload.eventId).toBe(eventId);
      expect(payload).not.toHaveProperty("action");
      const jobs = await h.owner.query(
        "SELECT idempotency_key FROM jobs WHERE tenant_id = $1 AND type = 'webhook.deliver'",
        [h.tenants.a],
      );
      expect(jobs.rows).toEqual([{ idempotency_key: `webhook:${eventId}:${subscription.id}` }]);
    },
  );

  test("connection snapshots use the documented signed shape and manual connections do not emit", async () => {
    const subscription = await hook(["brain.connection.new"]);
    const pages = [await page(), await page()].sort();
    const connectionId = newId("connection");
    await db.withTenant(h.tenants.a, (client) =>
      client.query(
        "INSERT INTO connections (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source) VALUES ($1, $2, $3, $4, $5, 0.9, 'strong', 'Related', 'manual')",
        [connectionId, h.tenants.a, brainId, ...pages],
      ),
    );
    await drain();
    expect(receipts).toHaveLength(0);
    await h.owner.query("DELETE FROM connections WHERE tenant_id = $1 AND id = $2", [
      h.tenants.a,
      connectionId,
    ]);
    await db.withTenant(h.tenants.a, (client) =>
      client.query(
        "INSERT INTO connections (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning) VALUES ($1, $2, $3, $4, $5, 0.9, 'strong', 'Related')",
        [connectionId, h.tenants.a, brainId, ...pages],
      ),
    );
    await drain();
    expect(receipts).toHaveLength(1);
    expect(signed(subscription.secret, "brain.connection.new")).toMatchObject({
      eventId: connectionId,
      connectionId,
      pageAId: pages[0],
      pageBId: pages[1],
      similarity: 0.9,
      strength: "strong",
      reasoning: "Related",
    });
  });

  test("permanently deleting a page preserves legacy change and delivery cascades", async () => {
    await hook(["created", "brain.change.new"]);
    const pageId = await page();
    const eventId = await change("created", pageId);
    await drain();
    expect(receipts).toHaveLength(1);
    await db.withTenant(h.tenants.a, (client) =>
      client.query("DELETE FROM pages WHERE tenant_id = $1 AND id = $2", [h.tenants.a, pageId]),
    );
    expect(
      (
        await h.owner.query("SELECT id FROM webhook_events WHERE tenant_id = $1 AND id = $2", [
          h.tenants.a,
          eventId,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await h.owner.query(
          "SELECT id FROM webhook_deliveries WHERE tenant_id = $1 AND event_id = $2",
          [h.tenants.a, eventId],
        )
      ).rows,
    ).toEqual([]);
  });

  test("overlapping PRD change subscriptions produce one page.updated delivery", async () => {
    const subscription = await hook(["brain.page.updated", "brain.change.new"]);
    await change("updated", await page());
    await drain();
    expect(receipts).toHaveLength(1);
    signed(subscription.secret, "brain.page.updated");
  });

  test.each(["completed", "failed"])(
    "an actual compile reaching %s delivers import progress once",
    async (status) => {
      const subscription = await hook(["brain.import.progress"]);
      const sourceId = newId("source");
      await h.owner.query(
        "INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, 'note', 'Import', 'hash')",
        [sourceId, h.tenants.a, h.subjects.a, brainId],
      );
      await h.owner.query(
        "INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key) VALUES ($1, $2, 'capture.compile', $3, $4)",
        [h.tenants.a, brainId, JSON.stringify({ sourceId, brainId }), `compile:${sourceId}`],
      );
      await drain(worker(status === "completed" ? '{"facts":[]}' : "invalid json"));
      expect(receipts).toHaveLength(1);
      expect(signed(subscription.secret, "brain.import.progress")).toMatchObject({
        sourceId,
        status,
        affectedPageIds: [],
      });
      await db.withTenant(h.tenants.a, (client) =>
        client.query("UPDATE ingest_sources SET status = $3 WHERE tenant_id = $1 AND id = $2", [
          h.tenants.a,
          sourceId,
          status,
        ]),
      );
      await drain();
      expect(receipts).toHaveLength(1);
    },
  );

  test("import transition snapshots and signed bodies remain stable across retries", async () => {
    const subscription = await hook(["brain.import.progress"]);
    const sourceId = newId("source");
    await h.owner.query(
      "INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, 'note', 'Import', 'hash')",
      [sourceId, h.tenants.a, h.subjects.a, brainId],
    );
    await h.owner.query(
      "UPDATE ingest_sources SET status = 'failed' WHERE tenant_id = $1 AND id = $2",
      [h.tenants.a, sourceId],
    );
    responseStatus = 503;
    expect(await worker().runOnce()).toBe(true);
    expect(signed(subscription.secret, "brain.import.progress").status).toBe("failed");
    await h.owner.query(
      "UPDATE ingest_sources SET status = 'completed' WHERE tenant_id = $1 AND id = $2",
      [h.tenants.a, sourceId],
    );
    await h.owner.query(
      "UPDATE jobs SET available_at = now() WHERE tenant_id = $1 AND type = 'webhook.deliver'",
      [h.tenants.a],
    );
    responseStatus = 204;
    await drain();
    const failedReceipts = receipts.filter(
      (receipt) => JSON.parse(receipt.body).status === "failed",
    );
    expect(failedReceipts).toHaveLength(2);
    expect(failedReceipts[0]?.body).toBe(failedReceipts[1]?.body);
    expect(receipts).toHaveLength(3);
    expect(new Set(receipts.map((receipt) => JSON.parse(receipt.body).eventId)).size).toBe(2);
  });

  test("brain purge removes snapshots and deliveries for every event kind", async () => {
    await hook(["brain.change.new", "brain.connection.new", "brain.import.progress"]);
    const pages = [await page(), await page()].sort();
    await change("created", pages[0] ?? "");
    const sourceId = newId("source");
    await h.owner.query(
      "INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, 'note', 'Purge', 'hash')",
      [sourceId, h.tenants.a, h.subjects.a, brainId],
    );
    await h.owner.query(
      "UPDATE ingest_sources SET status = 'completed' WHERE tenant_id = $1 AND id = $2",
      [h.tenants.a, sourceId],
    );
    await h.owner.query(
      "INSERT INTO connections (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning) VALUES ($1, $2, $3, $4, $5, 0.9, 'strong', 'Related')",
      [newId("connection"), h.tenants.a, brainId, ...pages],
    );
    await drain();
    expect(receipts).toHaveLength(3);
    expect((await h.request(`/v1/brains/${brainId}`, { method: "DELETE" })).status).toBe(202);
    const purge = createWorker({
      withTenant: db.withTenant,
      tenantIds: [h.tenants.a],
      store: createFakeStore(),
    });
    expect(await purge.runOnce()).toBe(true);
    expect(
      (
        await h.owner.query(
          "SELECT id FROM webhook_events WHERE tenant_id = $1 AND brain_id = $2",
          [h.tenants.a, brainId],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await h.owner.query("SELECT id FROM webhook_deliveries WHERE tenant_id = $1", [h.tenants.a]))
        .rows,
    ).toEqual([]);
  });

  test("a rolled back event creates neither an outbox event nor a delivery job", async () => {
    await hook(["brain.change.new"]);
    const pageId = await page();
    const eventId = newId("change");
    const rollback = new Error("rollback");
    await expect(
      db.withTenant(h.tenants.a, async (client) => {
        await client.query(
          "INSERT INTO change_events (id, tenant_id, brain_id, page_id, action, change_summary, to_version) VALUES ($1, $2, $3, $4, 'created', 'Rollback', 1)",
          [eventId, h.tenants.a, brainId, pageId],
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      (
        await h.owner.query("SELECT id FROM webhook_events WHERE tenant_id = $1 AND id = $2", [
          h.tenants.a,
          eventId,
        ])
      ).rows,
    ).toEqual([]);
    await drain();
    expect(receipts).toHaveLength(0);
  });
});
