import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createFakeProvider } from "@memtavi/llm/fake";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { chunkKey, exportKey, originalKey } from "@memtavi/storage/keys";
import type { ObjectStore } from "@memtavi/storage/types";
import { createWorker } from "@memtavi/worker";
import { compileCapture } from "@memtavi/worker/compile";
import { ingestCapture } from "@memtavi/worker/ingest";
import type { ClaimedJob, JobContext } from "@memtavi/worker/types";
import { deliverWebhook } from "@memtavi/worker/webhook";
import { purgeBrain } from "../../apps/worker/src/purge";
import { createContract } from "../support/contract";
import { createHarness, type Harness, type RequestOptions } from "../support/harness";

const contract = createContract();

describe("durable asynchronous brain deletion", () => {
  let harness: Harness;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  const store = createFakeStore();
  const subject = crypto.randomUUID();

  function request(path: string, options: RequestOptions = {}) {
    const headers = new Headers(options.headers);
    headers.set("x-api-key", options.key ?? harness.keys.a);
    headers.set("x-subject-id", options.subject ?? harness.subjects.a);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  async function brain(options: RequestOptions = {}) {
    const slug = `purge-${crypto.randomUUID()}`;
    const response = await request("/v1/brains", {
      ...options,
      method: "POST",
      body: {
        name: "Private brain",
        slug,
        description: "Private description",
        briefSettings: { private: true },
      },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; slug: string };
  }

  async function deletion(brainId: string) {
    const response = await request(`/v1/brains/${brainId}`, { method: "DELETE" });
    expect(response.status).toBe(202);
    const body = await response.json();
    contract.expectContract(response, body, { method: "DELETE", path: "/v1/brains/{brainId}" });
    expect(body).toEqual({ id: brainId, targetType: "brain", state: "pending" });
    const job = await harness.owner.query<ClaimedJob>(
      `SELECT id, tenant_id AS "tenantId", brain_id AS "brainId", type, payload,
       attempts, max_attempts AS "maxAttempts" FROM jobs
       WHERE tenant_id = $1 AND brain_id = $2 AND type = 'brain.purge'`,
      [harness.tenants.a, brainId],
    );
    expect(job.rowCount).toBe(1);
    const row = job.rows[0];
    if (!row) throw new Error("Purge job missing");
    return row;
  }

  function context(job: ClaimedJob, objectStore: ObjectStore = store): JobContext {
    return {
      job,
      client: {} as JobContext["client"],
      withTenant: db.withTenant,
      store: objectStore,
      fetchDocument: async () => {
        throw new Error("Unexpected fetch");
      },
    };
  }

  async function seed() {
    const target = await brain();
    const tenant = harness.tenants.a;
    const response = await request(`/v1/brains/${target.id}/captures`, {
      method: "POST",
      headers: { "Idempotency-Key": `capture-${target.id}` },
      body: { kind: "note", content: "Private source body" },
    });
    expect(response.status).toBe(201);
    const source = (await response.json()) as { id: string };
    const pageIds = [newId("page"), newId("page")].sort();
    const [pageA, pageB] = pageIds;
    const change = newId("change");
    const webhook = crypto.randomUUID();
    const exportJob = crypto.randomUUID();
    const chunk = chunkKey({
      tenantId: tenant,
      sourceId: source.id,
      body: "Private chunk",
      ordinal: 0,
    });
    const original = originalKey({
      tenantId: tenant,
      sourceId: source.id,
      body: "Private original",
      extension: "pdf",
    });
    const exported = exportKey({ tenantId: tenant, brainId: target.id, jobId: exportJob });
    for (const key of [chunk, original, exported]) await store.put(key, key, "text/plain");
    await harness.owner.query(
      "UPDATE ingest_sources SET metadata = $3 WHERE tenant_id = $1 AND id = $2",
      [tenant, source.id, { originalRef: original }],
    );
    await harness.owner.query(
      `INSERT INTO source_chunks (tenant_id, brain_id, source_id, ordinal, body_ref, char_start, char_end, token_count)
       VALUES ($1, $2, $3, 0, $4, 0, 13, 3)`,
      [tenant, target.id, source.id, chunk],
    );
    for (const [index, page] of pageIds.entries()) {
      await harness.owner.query(
        `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, body, content_hash)
         VALUES ($1, $2, $3, $4, $5, 'Private page', 'Private body', 'hash')`,
        [page, tenant, harness.subjects.a, target.id, `page-${index}`],
      );
    }
    await harness.owner.query(
      `INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, ingest_source_id, actor)
       VALUES ($1, $2, 1, 'Private version', '', '', $3, 'compiler')`,
      [tenant, pageA, source.id],
    );
    await harness.owner.query(
      "INSERT INTO page_sources (tenant_id, page_id, ingest_source_id) VALUES ($1, $2, $3)",
      [tenant, pageA, source.id],
    );
    await harness.owner.query(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       VALUES ($1, $2, 'fake', 1536, $3::vector, 'hash')`,
      [tenant, pageA, JSON.stringify(Array.from({ length: 1536 }, () => 0))],
    );
    await harness.owner.query(
      `INSERT INTO connections (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning)
       VALUES ($1, $2, $3, $4, $5, 0.8, 'strong', 'Private reason')`,
      [newId("connection"), tenant, target.id, pageA, pageB],
    );
    await harness.owner.query(
      `INSERT INTO routing_reviews (tenant_id, brain_id, ingest_source_id, fact) VALUES ($1, $2, $3, '{"private":true}')`,
      [tenant, target.id, source.id],
    );
    await harness.owner.query(
      `INSERT INTO change_events (id, tenant_id, brain_id, page_id, action, change_summary, to_version)
       VALUES ($1, $2, $3, $4, 'created', 'Private change', 1)`,
      [change, tenant, target.id, pageA],
    );
    await harness.owner.query(
      `INSERT INTO webhooks (id, tenant_id, subject_id, url, events, secret_enc)
       VALUES ($1, $2, $3, 'https://example.invalid/hook', '{created}', 'fixture')`,
      [webhook, tenant, harness.subjects.a],
    );
    await harness.owner.query(
      `INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, payload)
       VALUES ($1, $2, $3, '{"private":true}')`,
      [tenant, webhook, change],
    );
    await harness.owner.query(
      "INSERT INTO profiles (tenant_id, brain_id, focus) VALUES ($1, $2, 'Private focus')",
      [tenant, target.id],
    );
    await harness.owner.query(
      `INSERT INTO score_snapshots (tenant_id, brain_id, freshness, readiness, strain, factors)
       VALUES ($1, $2, 0.5, 0.5, 0.5, '{"private":true}')`,
      [tenant, target.id],
    );
    await harness.owner.query(
      "INSERT INTO briefs (tenant_id, brain_id, page_id, for_date) VALUES ($1, $2, $3, '2026-11-10')",
      [tenant, target.id, pageA],
    );
    await harness.owner.query(
      `INSERT INTO jobs (id, tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1::uuid, $2, $3, 'brain.export', $4, $1::text)`,
      [exportJob, tenant, target.id, { objectKey: exported }],
    );
    await harness.owner.query(
      `INSERT INTO usage_ledger (tenant_id, brain_id, job_id, provider, model, kind, cost_usd)
       VALUES ($1, $2, $3, 'fake', 'fake', 'chat', 0)`,
      [tenant, target.id, exportJob],
    );
    await harness.owner.query(
      `INSERT INTO deletion_ops (tenant_id, brain_id, target_type, target_id, state)
       VALUES ($1, $2, 'page', $3, 'deleted')`,
      [tenant, target.id, newId("page")],
    );
    const refs = await harness.owner.query<{ body_ref: string }>(
      "SELECT body_ref FROM ingest_sources WHERE tenant_id = $1 AND id = $2",
      [tenant, source.id],
    );
    const bodyRef = refs.rows[0]?.body_ref;
    if (!bodyRef) throw new Error("Source object missing");
    return {
      ...target,
      sourceId: source.id,
      pageIds,
      change,
      keys: [bodyRef, chunk, original, exported],
      webhook,
    };
  }

  async function assertPurged(target: Awaited<ReturnType<typeof seed>>) {
    const tenant = harness.tenants.a;
    for (const table of [
      "pages",
      "ingest_sources",
      "source_chunks",
      "connections",
      "routing_reviews",
      "change_events",
      "profiles",
      "score_snapshots",
      "briefs",
      "jobs",
      "usage_ledger",
    ]) {
      const rows = await harness.owner.query(
        `SELECT 1 FROM ${table} WHERE tenant_id = $1 AND brain_id = $2`,
        [tenant, target.id],
      );
      expect({ table, count: rows.rowCount }).toEqual({ table, count: 0 });
    }
    for (const table of ["page_versions", "page_sources", "page_embeddings"]) {
      const rows = await harness.owner.query(
        `SELECT 1 FROM ${table} WHERE tenant_id = $1 AND page_id = ANY($2::text[])`,
        [tenant, target.pageIds],
      );
      expect({ table, count: rows.rowCount }).toEqual({ table, count: 0 });
    }
    expect(
      (
        await harness.owner.query(
          "SELECT 1 FROM webhook_deliveries WHERE tenant_id = $1 AND event_id = $2",
          [tenant, target.change],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await harness.owner.query(
          "SELECT 1 FROM idempotency_keys WHERE tenant_id = $1 AND scope = $2",
          [tenant, `POST /v1/brains/${target.id}/captures`],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await harness.owner.query("SELECT 1 FROM webhooks WHERE tenant_id = $1 AND id = $2", [
          tenant,
          target.webhook,
        ])
      ).rowCount,
    ).toBe(1);
    const tombstone = await harness.owner.query(
      "SELECT deletion_state, name, slug, description, brief_settings, project_id FROM brains WHERE tenant_id = $1 AND id = $2",
      [tenant, target.id],
    );
    expect(tombstone.rows[0]).toEqual({
      deletion_state: "deleted",
      name: "",
      slug: "",
      description: "",
      brief_settings: {},
      project_id: null,
    });
    const operations = await harness.owner.query<{
      state: string;
      detail: { counts: Record<string, number>; objects: number };
    }>("SELECT state, detail FROM deletion_ops WHERE tenant_id = $1 AND brain_id = $2", [
      tenant,
      target.id,
    ]);
    expect(operations.rowCount).toBe(1);
    expect(operations.rows[0]?.state).toBe("completed");
    expect(operations.rows[0]?.detail.objects).toBe(target.keys.length);
    const counts = operations.rows[0]?.detail.counts ?? {};
    expect(Object.keys(counts)).toHaveLength(17);
    expect(Object.values(counts).every((count) => count > 0)).toBe(true);
    for (const key of target.keys) expect(await store.exists(key)).toBe(false);
  }

  beforeAll(async () => {
    harness = await createHarness();
    db = await import("@memtavi/db/client");
    app = createApp({ ownerPool: harness.owner, withTenant: db.withTenant, store });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  afterEach(async () => {
    if (!harness) return;
    const pending = await harness.owner.query<ClaimedJob>(
      `SELECT id, tenant_id AS "tenantId", brain_id AS "brainId", type, payload,
       attempts, max_attempts AS "maxAttempts" FROM jobs
       WHERE tenant_id = $1 AND type = 'brain.purge'`,
      [harness.tenants.a],
    );
    for (const job of pending.rows) await purgeBrain(context(job));
  });

  test("foreign tenants and subjects get 404 without a deletion, and viewer/developer get 403", async () => {
    const own = await brain();
    const foreign = await brain({ key: harness.keys.b, subject: harness.subjects.b });
    const sibling = await brain({ subject });
    for (const id of [foreign.id, sibling.id]) {
      const response = await request(`/v1/brains/${id}`, { method: "DELETE" });
      expect(response.status).toBe(404);
      contract.expectContract(response, await response.json(), {
        method: "DELETE",
        path: "/v1/brains/{brainId}",
      });
      expect(
        (await harness.owner.query("SELECT deletion_state FROM brains WHERE id = $1", [id])).rows[0]
          ?.deletion_state,
      ).toBe("active");
      expect(
        (await harness.owner.query("SELECT 1 FROM deletion_ops WHERE brain_id = $1", [id]))
          .rowCount,
      ).toBe(0);
      expect(
        (await harness.owner.query("SELECT 1 FROM jobs WHERE brain_id = $1", [id])).rowCount,
      ).toBe(0);
    }
    for (const role of ["viewer", "developer"]) {
      const created = await request("/v1/api-keys", {
        method: "POST",
        body: { name: `Purge ${role}`, role },
      });
      expect(created.status).toBe(201);
      const key = (await created.json()) as { key: string };
      const response = await request(`/v1/brains/${own.id}`, { method: "DELETE", key: key.key });
      expect(response.status).toBe(403);
      expect(
        (await harness.owner.query("SELECT deletion_state FROM brains WHERE id = $1", [own.id]))
          .rows[0]?.deletion_state,
      ).toBe("active");
    }
    const admin = await request("/v1/api-keys", {
      method: "POST",
      body: { name: "Purge admin", role: "admin" },
    });
    const key = (await admin.json()) as { key: string };
    expect((await request(`/v1/brains/${own.id}`, { method: "DELETE", key: key.key })).status).toBe(
      202,
    );
  });

  test("a 202 receipt immediately hides every read and capture and releases the slug", async () => {
    const target = await seed();
    const suffixes = [
      "",
      "/pages",
      "/pages/page-0",
      "/index",
      "/search?q=Private",
      "/graph",
      "/connections",
      "/changes",
      "/profile",
      "/score",
      "/export",
      "/sources",
      `/sources/${target.sourceId}`,
      `/sources/${target.sourceId}/content`,
    ];
    for (const suffix of suffixes) {
      const response = await request(`/v1/brains/${target.id}${suffix}`);
      expect({ suffix, status: response.status }).toEqual({ suffix, status: 200 });
    }
    const before = (await (await request("/v1/brains")).json()) as { total: number };
    await deletion(target.id);
    for (const suffix of suffixes) {
      const response = await request(`/v1/brains/${target.id}${suffix}`);
      expect({ suffix, status: response.status }).toEqual({ suffix, status: 404 });
    }
    const list = (await (await request("/v1/brains?limit=200")).json()) as {
      items: { id: string }[];
      total: number;
    };
    expect(list.total).toBe(before.total - 1);
    expect(list.items.some((item) => item.id === target.id)).toBe(false);
    for (const headers of [{}, { "Idempotency-Key": `capture-${target.id}` }]) {
      const response = await request(`/v1/brains/${target.id}/captures`, {
        method: "POST",
        headers,
        body: { kind: "note", content: "Private source body" },
      });
      expect(response.status).toBe(404);
    }
    expect(
      (
        await request(`/v1/brains/${target.id}`, {
          method: "PATCH",
          body: { name: "Resurrection" },
        })
      ).status,
    ).toBe(404);
    expect((await request(`/v1/brains/${target.id}`, { method: "DELETE" })).status).toBe(404);
    expect(
      (await request("/v1/brains", { method: "POST", body: { name: "Reused", slug: target.slug } }))
        .status,
    ).toBe(201);
  });

  test("deletion during a paused capture returns 404 and leaves no source or object after purge", async () => {
    const target = await brain();
    const previousApp = app;
    const paused = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const keys: string[] = [];
    app = createApp({
      ownerPool: harness.owner,
      withTenant: (tenantId, fn, subjectId) =>
        db.withTenant(
          tenantId,
          async (client) => {
            paused.resolve();
            await resume.promise;
            return fn(client);
          },
          subjectId,
        ),
      store: {
        ...store,
        async put(key, body, contentType) {
          keys.push(key);
          await store.put(key, body, contentType);
        },
      },
    });
    const capturing = request(`/v1/brains/${target.id}/captures`, {
      method: "POST",
      body: { kind: "note", content: "Paused capture body" },
    });
    try {
      await paused.promise;
      app = previousApp;
      const job = await deletion(target.id);
      await purgeBrain(context(job));
      resume.resolve();
      const response = await capturing;
      expect(response.status).toBe(404);
      contract.expectContract(response, await response.json(), {
        method: "POST",
        path: "/v1/brains/{brainId}/captures",
      });
      expect(
        (
          await harness.owner.query(
            "SELECT 1 FROM ingest_sources WHERE tenant_id = $1 AND brain_id = $2",
            [harness.tenants.a, target.id],
          )
        ).rowCount,
      ).toBe(0);
      expect(keys).toHaveLength(0);
    } finally {
      resume.resolve();
      await capturing;
      app = previousApp;
    }
  });

  test.each(["delete", "capture"] as const)(
    "%s wins an overlapping capture and deletion without leaving a source or object after purge",
    async (first) => {
      const target = await brain();
      const previousApp = app;
      const paused = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const secondEntered = Promise.withResolvers<number>();
      const keys: string[] = [];
      let transactions = 0;
      const overlapping: typeof db.withTenant = (tenantId, fn, subjectId) =>
        db.withTenant(
          tenantId,
          async (client) => {
            const turn = transactions++;
            if (turn === 1) {
              const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
              const pid = backend.rows[0]?.pid;
              if (pid === undefined) throw new Error("Backend pid missing");
              secondEntered.resolve(pid);
            }
            const result = await fn(client);
            if (turn === 0 && first === "delete") {
              paused.resolve();
              await resume.promise;
            }
            return result;
          },
          subjectId,
        );
      app = createApp({
        ownerPool: harness.owner,
        withTenant: overlapping,
        store: {
          ...store,
          async put(key, body, contentType) {
            keys.push(key);
            if (first === "capture") {
              paused.resolve();
              await resume.promise;
            }
            await store.put(key, body, contentType);
          },
        },
      });
      const capture = () =>
        request(`/v1/brains/${target.id}/captures`, {
          method: "POST",
          body: { kind: "note", content: "Overlapping capture body" },
        });
      let capturing: Promise<Response> | undefined;
      let deleting: Promise<ClaimedJob> | undefined;
      try {
        if (first === "delete") deleting = deletion(target.id);
        else capturing = capture();
        await paused.promise;
        if (first === "delete") capturing = capture();
        else deleting = deletion(target.id);
        const pid = await secondEntered.promise;
        let blocked = false;
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const locks = await harness.owner.query<{ blocked: boolean }>(
            "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
            [pid],
          );
          if (locks.rows[0]?.blocked) {
            blocked = true;
            break;
          }
        }
        expect(blocked).toBe(true);
        resume.resolve();
        const response = await capturing;
        const job = await deleting;
        if (!response || !job) throw new Error("Overlapping requests missing");
        expect(response.status).toBe(first === "delete" ? 404 : 201);
        contract.expectContract(response, await response.json(), {
          method: "POST",
          path: "/v1/brains/{brainId}/captures",
        });
        await purgeBrain(context(job));
        for (const table of ["ingest_sources", "jobs"]) {
          const rows = await harness.owner.query(
            `SELECT 1 FROM ${table} WHERE tenant_id = $1 AND brain_id = $2`,
            [harness.tenants.a, target.id],
          );
          expect({ table, count: rows.rowCount }).toEqual({ table, count: 0 });
        }
        expect(keys).toHaveLength(first === "delete" ? 0 : 1);
        for (const key of keys) expect(await store.exists(key)).toBe(false);
      } finally {
        resume.resolve();
        await Promise.allSettled([capturing, deleting]);
        app = previousApp;
      }
    },
  );

  test("purge removes every child and stored object after committing rows, preserving its record", async () => {
    const target = await seed();
    const job = await deletion(target.id);
    const foreignKey = originalKey({
      tenantId: harness.tenants.b,
      sourceId: newId("source"),
      body: "Foreign",
      extension: "txt",
    });
    await store.put(foreignKey, "Foreign", "text/plain");
    await harness.owner.query(
      "UPDATE ingest_sources SET metadata = metadata || $3::jsonb WHERE tenant_id = $1 AND id = $2",
      [harness.tenants.a, target.sourceId, { foreignRef: foreignKey }],
    );
    const observing: ObjectStore = {
      ...store,
      async delete(key) {
        expect(
          (
            await harness.owner.query(
              "SELECT 1 FROM pages WHERE tenant_id = $1 AND brain_id = $2",
              [harness.tenants.a, target.id],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await harness.owner.query(
              "SELECT state FROM deletion_ops WHERE tenant_id = $1 AND brain_id = $2",
              [harness.tenants.a, target.id],
            )
          ).rows[0]?.state,
        ).toBe("purging");
        await store.delete(key);
      },
    };
    await purgeBrain(context(job, observing));
    await assertPurged(target);
    expect(await store.exists(foreignKey)).toBe(true);
    await purgeBrain(
      context(job, {
        ...store,
        async delete() {
          throw new Error("Repeated deletion");
        },
      }),
    );
    expect(
      (
        await request("/v1/brains", {
          method: "POST",
          body: { name: "Reused tombstone", slug: target.slug },
        })
      ).status,
    ).toBe(201);
  });

  test.each([0, 1])(
    "worker retry finishes a crash after rows commit and %i objects are removed",
    async (failAfter) => {
      const target = await seed();
      await deletion(target.id);
      let deletes = 0;
      let fail = true;
      const failing: ObjectStore = {
        ...store,
        async delete(key) {
          if (fail && deletes++ === failAfter) throw new Error("Simulated storage outage");
          await store.delete(key);
        },
      };
      const worker = createWorker({
        withTenant: db.withTenant,
        tenantIds: [harness.tenants.a],
        store: failing,
        random: () => 0,
        handlers: { "brain.purge": purgeBrain },
      });
      expect(await worker.runOnce()).toBe(true);
      expect(
        (
          await harness.owner.query("SELECT 1 FROM pages WHERE tenant_id = $1 AND brain_id = $2", [
            harness.tenants.a,
            target.id,
          ])
        ).rowCount,
      ).toBe(0);
      const state = await harness.owner.query(
        "SELECT state, detail FROM deletion_ops WHERE tenant_id = $1 AND brain_id = $2",
        [harness.tenants.a, target.id],
      );
      expect(state.rows[0]?.state).toBe("purging");
      expect(state.rows[0]?.detail.keys.length).toBeGreaterThanOrEqual(4);
      expect(
        (
          await harness.owner.query(
            "SELECT status FROM jobs WHERE tenant_id = $1 AND brain_id = $2",
            [harness.tenants.a, target.id],
          )
        ).rows[0]?.status,
      ).toBe("pending");
      fail = false;
      await harness.owner.query(
        "UPDATE jobs SET available_at = now() WHERE tenant_id = $1 AND brain_id = $2",
        [harness.tenants.a, target.id],
      );
      expect(await worker.runOnce()).toBe(true);
      await assertPurged(target);
      expect(await worker.runOnce()).toBe(false);
    },
  );

  test("a crash before the row transaction commits leaves rows and objects for retry", async () => {
    const target = await seed();
    const job = await deletion(target.id);
    let fail = true;
    const crashing: typeof db.withTenant = (tenantId, fn, subjectId) =>
      db.withTenant(
        tenantId,
        async (client) => {
          const result = await fn(client);
          if (fail) throw new Error("Simulated transaction crash");
          return result;
        },
        subjectId,
      );
    await expect(purgeBrain({ ...context(job), withTenant: crashing })).rejects.toThrow(
      "Simulated transaction crash",
    );
    expect(
      (
        await harness.owner.query("SELECT 1 FROM pages WHERE tenant_id = $1 AND brain_id = $2", [
          harness.tenants.a,
          target.id,
        ])
      ).rowCount,
    ).toBe(2);
    expect(
      (
        await harness.owner.query(
          "SELECT state FROM deletion_ops WHERE tenant_id = $1 AND brain_id = $2 AND target_type = 'brain'",
          [harness.tenants.a, target.id],
        )
      ).rows[0]?.state,
    ).toBe("pending");
    for (const key of target.keys) expect(await store.exists(key)).toBe(true);
    fail = false;
    await purgeBrain({ ...context(job), withTenant: crashing });
    await assertPurged(target);
  });

  test("the default worker claims the purge and clears previously queued work", async () => {
    const target = await seed();
    await deletion(target.id);
    const worker = createWorker({
      withTenant: db.withTenant,
      tenantIds: [harness.tenants.a],
      store,
      fetchDocument: async () => {
        throw new Error("Unexpected fetch");
      },
    });
    for (let attempts = 0; attempts < 5 && (await worker.runOnce()); attempts += 1) {}
    await assertPurged(target);
  });

  test("queued compiler, ingest and webhook work is permanently inert for deleting and deleted brains", async () => {
    const target = await seed();
    const purgeJob = await deletion(target.id);
    let calls = 0;
    const fake = createFakeProvider();
    const provider = {
      ...fake,
      async chat(...args: Parameters<typeof fake.chat>) {
        calls += 1;
        return fake.chat(...args);
      },
      async embed(...args: Parameters<typeof fake.embed>) {
        calls += 1;
        return fake.embed(...args);
      },
    };
    for (const phase of ["deleting", "deleted"]) {
      if (phase === "deleted") await purgeBrain(context(purgeJob));
      for (const handler of [compileCapture, ingestCapture, deliverWebhook]) {
        await db.withTenant(harness.tenants.a, (client) =>
          handler({
            ...context({
              ...purgeJob,
              type: "capture.compile",
              payload: { brainId: target.id, sourceId: target.sourceId },
            }),
            client,
            compiler: {
              chatProvider: provider,
              embeddingProvider: provider,
              chatModel: "fake",
              embeddingModel: "fake",
            },
            store: {
              ...store,
              async put() {
                throw new Error("Unexpected object write");
              },
            },
            postJson: async () => {
              throw new Error("Unexpected webhook");
            },
          }),
        );
      }
    }
    expect(calls).toBe(0);
    await assertPurged(target);
  });
});
