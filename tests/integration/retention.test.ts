import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createFakeStore } from "@memtavi/storage/fake";
import { chunkKey, contentHash, originalKey, sourceKey } from "@memtavi/storage/keys";
import type { ObjectStore } from "@memtavi/storage/types";
import { createWorker, RETENTION_BATCH_SIZE, sweepRetention } from "@memtavi/worker";
import { ingestCapture } from "@memtavi/worker/ingest";
import { createHarness, type Harness, hasTestDatabase } from "../support/harness";

if (!hasTestDatabase) throw new Error("Retention tests require the test database environment");

const NOW = new Date("2026-11-11T12:00:00.000Z");
const BODY = "A durable claim with a much longer original source body.";
const SUMMARY = "A durable claim.";

interface Fixture {
  id: string;
  keys: string[];
}

describe("source body retention", () => {
  let harness: Harness;
  let db: typeof import("@memtavi/db/client");
  let store: ObjectStore;
  let brainA: string;
  let brainB: string;

  beforeAll(async () => {
    harness = await createHarness(() => NOW);
    db = await import("@memtavi/db/client");
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    store = createFakeStore();
    await harness.owner.query("DELETE FROM brains WHERE tenant_id = ANY($1::uuid[])", [
      [harness.tenants.a, harness.tenants.b],
    ]);
    for (const tenant of ["a", "b"] as const) {
      const response = await harness.request("/v1/brains", {
        key: harness.keys[tenant],
        subject: harness.subjects[tenant],
        method: "POST",
        body: { name: "Retention", slug: "retention" },
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string };
      if (tenant === "a") brainA = body.id;
      else brainB = body.id;
      await harness.owner.query(
        `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
         VALUES ($1, $2, 'retention.sweep', '{}', $3)`,
        [harness.tenants[tenant], body.id, `retention:${crypto.randomUUID()}`],
      );
    }
  });

  async function source(days: number, tenant: "a" | "b" = "a"): Promise<Fixture> {
    const id = `src_${crypto.randomUUID().replaceAll("-", "")}`;
    const tenantId = harness.tenants[tenant];
    const brainId = tenant === "a" ? brainA : brainB;
    const keys = [
      sourceKey({ tenantId, sourceId: id, body: BODY }),
      originalKey({ tenantId, sourceId: id, body: BODY, extension: "html" }),
      chunkKey({ tenantId, sourceId: id, body: BODY, ordinal: 0 }),
      sourceKey({ tenantId, sourceId: id, body: "previous body from capture job" }),
    ];
    for (const key of keys) await store.put(key, BODY, "text/plain");
    const completed = new Date(NOW.getTime() - days * 86_400_000);
    await harness.owner.query(
      `INSERT INTO ingest_sources
       (id, tenant_id, subject_id, brain_id, kind, content, summary, content_hash,
        body_ref, body_bytes, original_bytes, status, compiled_at, created_at, metadata)
       VALUES ($1, $2, $3, $4, 'note', $5, $6, $7, $8, 100, 100, 'completed', $9, $9, $10)`,
      [
        id,
        tenantId,
        harness.subjects[tenant],
        brainId,
        BODY,
        SUMMARY,
        contentHash(BODY),
        keys[0],
        completed,
        JSON.stringify({ originalRef: keys[1], summary: SUMMARY }),
      ],
    );
    await harness.owner.query(
      `INSERT INTO source_chunks
       (tenant_id, brain_id, source_id, ordinal, text, body_ref, char_start, char_end, token_count)
       VALUES ($1, $2, $3, 0, $4, $5, 0, 50, 15)`,
      [tenantId, brainId, id, BODY, keys[2]],
    );
    await harness.owner.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, status)
       VALUES ($1, $2, 'capture.ingest', $3, $4, 'completed')`,
      [
        tenantId,
        brainId,
        JSON.stringify({ sourceId: id, brainId, originalRef: keys[3] }),
        `capture:${id}`,
      ],
    );
    await harness.owner.query(
      `INSERT INTO idempotency_keys
       (tenant_id, scope, key, request_hash, response_status, response_body, expires_at)
       VALUES ($1, $2, $3, 'hash', 201, $4, $5)`,
      [
        tenantId,
        `POST /v1/brains/${brainId}/captures`,
        id,
        JSON.stringify({ id, contentPreview: BODY, contentUrl: null }),
        NOW,
      ],
    );
    return { id, keys };
  }

  async function page(sourceId: string, pinned = false): Promise<string> {
    const id = `pg_${crypto.randomUUID().replaceAll("-", "")}`;
    await harness.owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash, pinned)
       VALUES ($1, $2, $3, $4, $1, 'Evidence', 'hash', $5)`,
      [id, harness.tenants.a, harness.subjects.a, brainA, pinned],
    );
    await db.withTenant(harness.tenants.a, (client) =>
      client.query(
        "INSERT INTO page_sources (tenant_id, page_id, ingest_source_id) VALUES ($1, $2, $3)",
        [harness.tenants.a, id, sourceId],
      ),
    );
    return id;
  }

  function worker(tenant: "a" | "b" = "a", objectStore = store) {
    return createWorker({
      withTenant: db.withTenant,
      tenantIds: [harness.tenants[tenant]],
      store: objectStore,
      handlers: { "retention.sweep": sweepRetention },
      now: () => NOW,
      random: () => 0,
    });
  }

  async function row(id: string) {
    return (
      await harness.owner.query("SELECT * FROM ingest_sources WHERE tenant_id = $1 AND id = $2", [
        harness.tenants.a,
        id,
      ])
    ).rows[0];
  }

  async function due() {
    await harness.owner.query(
      `UPDATE jobs SET available_at = now() - interval '1 second'
       WHERE tenant_id = $1 AND type = 'retention.sweep' AND status = 'pending'`,
      [harness.tenants.a],
    );
  }

  test("a foreign sweep cannot read, mutate or delete another tenant's bodies", async () => {
    const a = await source(91);
    const negative = await harness.request(`/v1/brains/${brainA}/sources/${a.id}`, {
      key: harness.keys.b,
      subject: harness.subjects.b,
    });
    expect(negative.status).toBe(404);
    const foreign = await db.withTenant(harness.tenants.b, (client) =>
      client.query("SELECT id FROM ingest_sources WHERE tenant_id = $1 AND id = $2", [
        harness.tenants.a,
        a.id,
      ]),
    );
    expect(foreign.rowCount).toBe(0);
    const b = await source(91, "b");
    expect(await worker("b").runOnce()).toBe(true);
    expect((await row(a.id)).content).toBe(BODY);
    for (const key of a.keys) expect(await store.exists(key)).toBe(true);
    for (const key of b.keys) expect(await store.exists(key)).toBe(false);
    const unscoped = await db.pool.query("SELECT id FROM ingest_sources WHERE id = $1", [a.id]);
    expect(unscoped.rowCount).toBe(0);
  });

  test("worker startup seeds a tenant sweep only when none is pending or running", async () => {
    await harness.owner.query(
      "DELETE FROM jobs WHERE tenant_id = $1 AND type = 'retention.sweep'",
      [harness.tenants.a],
    );
    const runner = createWorker({
      withTenant: db.withTenant,
      tenantIds: [harness.tenants.a],
      store,
      concurrency: 1,
      handlers: {
        "retention.sweep": async () => {
          void runner.stop();
        },
      },
    });
    await runner.start();
    const seeded = await harness.owner.query(
      "SELECT status FROM jobs WHERE tenant_id = $1 AND type = 'retention.sweep'",
      [harness.tenants.a],
    );
    expect(seeded.rowCount).toBe(1);
    expect(seeded.rows[0].status).toBe("completed");
    await harness.owner.query(
      `UPDATE jobs SET status = 'pending', available_at = now()
       WHERE tenant_id = $1 AND type = 'retention.sweep'`,
      [harness.tenants.a],
    );
    const again = createWorker({
      withTenant: db.withTenant,
      tenantIds: [harness.tenants.a],
      store,
      concurrency: 1,
      handlers: {
        "retention.sweep": async () => {
          void again.stop();
        },
      },
    });
    await again.start();
    expect(
      (
        await harness.owner.query(
          "SELECT id FROM jobs WHERE tenant_id = $1 AND type = 'retention.sweep'",
          [harness.tenants.a],
        )
      ).rowCount,
    ).toBe(1);
  });

  test("only a source uncited for more than 90 days loses its body and keeps its summary and hash", async () => {
    const old = await source(91);
    for (const key of [
      sourceKey({ tenantId: harness.tenants.a, sourceId: old.id, body: "unreferenced old body" }),
      originalKey({ tenantId: harness.tenants.a, sourceId: old.id, body: BODY, extension: "pdf" }),
      chunkKey({ tenantId: harness.tenants.a, sourceId: old.id, body: BODY, ordinal: 99 }),
    ]) {
      await store.put(key, BODY, "text/plain");
      old.keys.push(key);
    }
    const recent = await source(89);
    const boundary = await source(90);
    const cited = await source(91);
    const pinned = await source(91);
    await page(cited.id);
    await page(pinned.id, true);
    const before = await row(old.id);
    expect(await worker().runOnce()).toBe(true);
    const dropped = await row(old.id);
    expect(dropped.content).toBe("");
    expect(dropped.body_ref).toBeNull();
    expect(dropped.body_bytes).toBe(0);
    expect(dropped.body_dropped_at.toISOString()).toBe(NOW.toISOString());
    expect(dropped.body_delete_keys).toEqual([]);
    expect(dropped.summary).toBe(SUMMARY);
    expect(dropped.content_hash).toBe(contentHash(BODY));
    const receipt = await harness.owner.query(
      "SELECT response_body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2",
      [harness.tenants.a, old.id],
    );
    expect(receipt.rows[0].response_body.contentPreview).toBe("");
    for (const field of ["status", "created_at", "compiled_at", "original_bytes"]) {
      expect(dropped[field]).toEqual(before[field]);
    }
    const chunks = await harness.owner.query(
      "SELECT text, body_ref FROM source_chunks WHERE tenant_id = $1 AND source_id = $2",
      [harness.tenants.a, old.id],
    );
    expect(chunks.rowCount).toBe(1);
    expect(chunks.rows[0].text).toBeNull();
    expect(chunks.rows[0].body_ref).toBeNull();
    for (const key of old.keys) expect(await store.exists(key)).toBe(false);
    for (const kept of [recent, boundary, cited, pinned]) {
      expect((await row(kept.id)).content).toBe(BODY);
      for (const key of kept.keys) expect(await store.exists(key)).toBe(true);
    }
    const response = await harness.request(`/v1/brains/${brainA}/sources/${old.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { contentPreview: string; contentUrl: string | null };
    expect(body.contentPreview).toBe("");
    expect(body.contentUrl).toBeNull();
    expect((await harness.request(`/v1/brains/${brainA}/sources/${old.id}/content`)).status).toBe(
      404,
    );
    await due();
    expect(await worker().runOnce()).toBe(true);
    const unchanged = await row(old.id);
    expect(unchanged.body_dropped_at).toEqual(dropped.body_dropped_at);
    expect(unchanged.summary).toBe(SUMMARY);
    expect(unchanged.content_hash).toBe(contentHash(BODY));
    expect(unchanged.body_delete_keys).toEqual([]);
  });

  test("the last citation starts the clock and re-citation clears it", async () => {
    const fixture = await source(91);
    const first = await page(fixture.id);
    const second = await page(fixture.id);
    expect((await row(fixture.id)).uncited_since).toBeNull();
    await db.withTenant(harness.tenants.a, (client) =>
      client.query("DELETE FROM page_sources WHERE tenant_id = $1 AND page_id = $2", [
        harness.tenants.a,
        first,
      ]),
    );
    expect((await row(fixture.id)).uncited_since).toBeNull();
    await db.withTenant(harness.tenants.a, (client) =>
      client.query("DELETE FROM page_sources WHERE tenant_id = $1 AND page_id = $2", [
        harness.tenants.a,
        second,
      ]),
    );
    expect((await row(fixture.id)).uncited_since).toBeInstanceOf(Date);
    await page(fixture.id);
    expect((await row(fixture.id)).uncited_since).toBeNull();
    expect(await worker().runOnce()).toBe(true);
    expect((await row(fixture.id)).body_dropped_at).toBeNull();
  });

  test("an adapter without listing fails before dropping any source body", async () => {
    const fixture = await source(91);
    const unsupported = { ...store };
    delete unsupported.list;
    expect(await worker("a", unsupported).runOnce()).toBe(true);
    expect((await row(fixture.id)).body_dropped_at).toBeNull();
    expect((await row(fixture.id)).content).toBe(BODY);
    for (const key of fixture.keys) expect(await store.exists(key)).toBe(true);
  });

  test.each([1, 2])(
    "a crash at delete %i resumes committed cleanup on the next leased job attempt",
    async (failureAt) => {
      const fixture = await source(91);
      let deletes = 0;
      const crashing: ObjectStore = {
        ...store,
        async delete(key) {
          const committed = await row(fixture.id);
          expect(committed.content).toBe("");
          expect(committed.body_dropped_at).toBeInstanceOf(Date);
          expect(committed.body_delete_keys.length).toBe(4);
          deletes += 1;
          if (deletes === failureAt) throw new Error("simulated interruption");
          await store.delete(key);
        },
      };
      expect(await worker("a", crashing).runOnce()).toBe(true);
      expect((await row(fixture.id)).body_delete_keys.length).toBe(4);
      const retried = await harness.owner.query(
        `SELECT attempts, status FROM jobs WHERE tenant_id = $1 AND type = 'retention.sweep'`,
        [harness.tenants.a],
      );
      expect(retried.rows[0].attempts).toBe(1);
      expect(retried.rows[0].status).toBe("pending");
      await due();
      expect(await worker().runOnce()).toBe(true);
      for (const key of fixture.keys) expect(await store.exists(key)).toBe(false);
      expect((await row(fixture.id)).body_delete_keys).toEqual([]);
    },
  );

  test("retention deletes a source body replaced by URL ingestion", async () => {
    const fixture = await source(91);
    await harness.owner.query(
      `UPDATE ingest_sources SET kind = 'url', content = 'https://example.invalid/source', status = 'pending'
       WHERE tenant_id = $1 AND id = $2`,
      [harness.tenants.a, fixture.id],
    );
    await harness.owner.query(
      `UPDATE jobs SET status = 'pending' WHERE tenant_id = $1
       AND type = 'capture.ingest' AND payload->>'sourceId' = $2`,
      [harness.tenants.a, fixture.id],
    );
    const ingest = createWorker({
      withTenant: db.withTenant,
      tenantIds: [harness.tenants.a],
      store,
      handlers: { "capture.ingest": ingestCapture },
      fetchDocument: async () => ({
        status: 200,
        finalUrl: "https://example.invalid/source",
        contentType: "text/plain",
        text: "replacement body",
      }),
    });
    expect(await ingest.runOnce()).toBe(true);
    expect((await row(fixture.id)).metadata.bodyRefs).toEqual([fixture.keys[0]]);
    const replacement = sourceKey({
      tenantId: harness.tenants.a,
      sourceId: fixture.id,
      body: "replacement body",
    });
    expect(await store.exists(replacement)).toBe(true);
    await harness.owner.query(
      `UPDATE ingest_sources SET status = 'completed' WHERE tenant_id = $1 AND id = $2`,
      [harness.tenants.a, fixture.id],
    );
    await harness.owner.query(
      "UPDATE ingest_sources SET uncited_since = $3 WHERE tenant_id = $1 AND id = $2",
      [harness.tenants.a, fixture.id, new Date(NOW.getTime() - 91 * 86_400_000)],
    );
    expect(await worker().runOnce()).toBe(true);
    for (const key of [...fixture.keys, replacement]) expect(await store.exists(key)).toBe(false);
  });

  test("deleting and deleted brains and formerly cited pinned pages retain their bodies", async () => {
    const fixture = await source(91);
    const pinnedPage = await page(fixture.id, true);
    await harness.owner.query(
      "UPDATE ingest_sources SET affected_page_ids = $3 WHERE tenant_id = $1 AND id = $2",
      [harness.tenants.a, fixture.id, [pinnedPage]],
    );
    await harness.owner.query("DELETE FROM page_sources WHERE tenant_id = $1 AND page_id = $2", [
      harness.tenants.a,
      pinnedPage,
    ]);
    await harness.owner.query(
      "UPDATE ingest_sources SET uncited_since = $3 WHERE tenant_id = $1 AND id = $2",
      [harness.tenants.a, fixture.id, new Date(NOW.getTime() - 91 * 86_400_000)],
    );
    expect(await worker().runOnce()).toBe(true);
    expect((await row(fixture.id)).body_dropped_at).toBeNull();
    for (const state of ["deleting", "deleted"]) {
      await harness.owner.query(
        "UPDATE brains SET deletion_state = $3 WHERE tenant_id = $1 AND id = $2",
        [harness.tenants.a, brainA, state],
      );
      await due();
      await worker().runOnce();
      expect((await row(fixture.id)).content).toBe(BODY);
    }
  });

  test("a sweep is batch bounded and queues immediate continuation followed by a daily sweep", async () => {
    const fixtures: Fixture[] = [];
    for (let index = 0; index <= RETENTION_BATCH_SIZE; index += 1) fixtures.push(await source(91));
    const runner = worker();
    expect(await runner.runOnce()).toBe(true);
    const count = await harness.owner.query(
      `SELECT count(*)::int AS count FROM ingest_sources
       WHERE tenant_id = $1 AND body_dropped_at IS NOT NULL`,
      [harness.tenants.a],
    );
    expect(count.rows[0].count).toBe(RETENTION_BATCH_SIZE);
    expect(await runner.runOnce()).toBe(true);
    for (const fixture of fixtures)
      expect((await row(fixture.id)).body_dropped_at).toBeInstanceOf(Date);
    expect(await runner.runOnce()).toBe(false);
    const pending = await harness.owner.query(
      `SELECT available_at > now() AS future FROM jobs
       WHERE tenant_id = $1 AND type = 'retention.sweep' AND status = 'pending'`,
      [harness.tenants.a],
    );
    expect(pending.rowCount).toBe(1);
    expect(pending.rows[0].future).toBe(true);
  }, 20_000);
});
