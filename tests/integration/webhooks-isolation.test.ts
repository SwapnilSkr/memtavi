import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { createWorker } from "@memtavi/worker";
import { deliverWebhook } from "@memtavi/worker/webhook";
import { createHarness, type Harness, WEBHOOK_SECRET_KEY } from "../support/harness";

const events = [
  "brain.page.updated",
  "brain.change.new",
  "brain.connection.new",
  "brain.import.progress",
];

describe("webhook event tenant and subject isolation", () => {
  let h: Harness;
  let db: typeof import("@memtavi/db/client");

  beforeAll(async () => {
    h = await createHarness();
    db = await import("@memtavi/db/client");
  });

  afterAll(async () => {
    await h?.close();
  });

  test("foreign and sibling webhooks never receive events, even with forged delivery jobs", async () => {
    const brain = await h.request("/v1/brains", {
      method: "POST",
      body: { name: "Private", slug: "private" },
    });
    expect(brain.status).toBe(201);
    const brainId = ((await brain.json()) as { id: string }).id;
    const denied = await h.request(`/v1/brains/${brainId}`, { key: h.keys.b });
    expect(denied.status).toBe(404);
    const foreignBrain = await h.request("/v1/brains", {
      key: h.keys.b,
      method: "POST",
      body: { name: "Foreign", slug: "foreign" },
    });
    const foreignBrainId = ((await foreignBrain.json()) as { id: string }).id;
    const sibling = crypto.randomUUID();
    const hooks: string[] = [];
    for (const [key, subject] of [
      [h.keys.b, h.subjects.a],
      [h.keys.a, sibling],
      [h.keys.a, h.subjects.a],
    ] as const) {
      const response = await h.request("/v1/webhooks", {
        key,
        subject,
        method: "POST",
        body: { url: `https://subscriber.example/${hooks.length}`, events },
      });
      expect(response.status).toBe(201);
      hooks.push(((await response.json()) as { id: string }).id);
    }
    const pageIds = [newId("page"), newId("page")].sort();
    for (const pageId of pageIds) {
      await h.owner.query(
        "INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash) VALUES ($1, $2, $3, $4, $1, 'Private', 'hash')",
        [pageId, h.tenants.a, h.subjects.a, brainId],
      );
    }
    const changeId = newId("change");
    const connectionId = newId("connection");
    const sourceId = newId("source");
    await db.withTenant(h.tenants.a, async (client) => {
      await client.query(
        "INSERT INTO change_events (id, tenant_id, brain_id, page_id, action, change_summary, to_version) VALUES ($1, $2, $3, $4, 'created', 'Private', 1)",
        [changeId, h.tenants.a, brainId, pageIds[0]],
      );
      await client.query(
        "INSERT INTO connections (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning) VALUES ($1, $2, $3, $4, $5, 1, 'strong', 'Private')",
        [connectionId, h.tenants.a, brainId, ...pageIds],
      );
      await client.query(
        "INSERT INTO ingest_sources (id, tenant_id, brain_id, subject_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, 'note', 'Private', 'hash')",
        [sourceId, h.tenants.a, brainId, h.subjects.a],
      );
      await client.query(
        "UPDATE ingest_sources SET status = 'completed' WHERE tenant_id = $1 AND id = $2",
        [h.tenants.a, sourceId],
      );
    });
    expect(
      (
        await h.owner.query(
          "SELECT id FROM jobs WHERE tenant_id = $1 AND type = 'webhook.deliver'",
          [h.tenants.b],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await h.owner.query(
          "SELECT id FROM jobs WHERE tenant_id = $1 AND payload->>'webhookId' = $2",
          [h.tenants.a, hooks[1]],
        )
      ).rows,
    ).toEqual([]);
    const sourceEvents = await h.owner.query<{ id: string }>(
      "SELECT id FROM webhook_events WHERE tenant_id = $1 ORDER BY id",
      [h.tenants.a],
    );
    expect(sourceEvents.rows).toHaveLength(3);
    await db.withTenant(h.tenants.b, async (client) => {
      expect(
        (
          await client.query("SELECT id FROM webhook_events WHERE id = ANY($1::text[])", [
            sourceEvents.rows.map(({ id }) => id),
          ])
        ).rows,
      ).toEqual([]);
    });
    for (const { id } of sourceEvents.rows) {
      await expect(
        db.withTenant(h.tenants.b, (client) =>
          client.query(
            "INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, payload) VALUES ($1, $2, $3, '{}')",
            [h.tenants.b, hooks[0], id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await h.owner.query(
        "INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key) VALUES ($1, $2, 'webhook.deliver', $3, $4)",
        [
          h.tenants.b,
          foreignBrainId,
          JSON.stringify({ webhookId: hooks[0], eventId: id }),
          `forged:${id}`,
        ],
      );
    }
    const posts: string[] = [];
    const instance = createWorker({
      withTenant: db.withTenant,
      tenantIds: [h.tenants.b, h.tenants.a],
      store: createFakeStore(),
      handlers: { "webhook.deliver": deliverWebhook },
      webhookSecretKey: WEBHOOK_SECRET_KEY,
      postJson: async (url) => {
        posts.push(url);
        return { status: 204, finalUrl: url, contentType: null, text: "" };
      },
    });
    for (let i = 0; i < 10; i += 1) {
      if (!(await instance.runOnce())) break;
    }
    expect(posts).not.toContain("https://subscriber.example/0");
    expect(posts).not.toContain("https://subscriber.example/1");
    expect(posts).toEqual(Array.from({ length: 3 }, () => "https://subscriber.example/2"));
    expect(
      (await h.owner.query("SELECT id FROM webhook_deliveries WHERE tenant_id = $1", [h.tenants.b]))
        .rows,
    ).toEqual([]);
  });
});
