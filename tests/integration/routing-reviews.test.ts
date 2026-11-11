import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtractedFact } from "@memtavi/core/compile/schemas";
import { createFakeProvider } from "@memtavi/llm/fake";
import { ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { createWorker, type Worker } from "@memtavi/worker";
import { createHarness, type Harness } from "../support/harness";

interface Review {
  id: string;
  sourceId: string;
  fact: { claim: string; entities: string[]; evidence: ExtractedFact["evidence"] };
  candidates: { pageId: string; slug: string; title: string }[];
  status: string;
  resolution: string | null;
  createdAt: string;
}

const claim = "Acme ships on Friday.";

describe("routing reviews", () => {
  let h: Harness;
  let brainId: string;
  let sourceId: string;
  let reviewId: string;
  let candidates: [string, string];
  let worker: Worker;
  let provider = createFakeProvider();
  let contradict = false;
  let unchanged = false;
  let failEmbedding = false;

  function path(suffix = "") {
    return `/v1/brains/${brainId}/routing-reviews${suffix}`;
  }

  async function resolve(body: unknown = { pageId: candidates[0] }) {
    return h.request(path(`/${reviewId}/resolve`), { method: "POST", body });
  }

  async function placedState() {
    return (
      await h.owner.query(
        `SELECT (SELECT count(*)::int FROM page_versions WHERE tenant_id = $1) AS versions,
        (SELECT count(*)::int FROM change_events WHERE tenant_id = $1) AS events,
        (SELECT count(*)::int FROM page_sources WHERE tenant_id = $1) AS links,
        (SELECT count(*)::int FROM page_embeddings WHERE tenant_id = $1) AS embeddings`,
        [h.tenants.a],
      )
    ).rows[0];
  }

  beforeEach(async () => {
    h = await createHarness();
    provider = createFakeProvider();
    contradict = false;
    unchanged = false;
    failEmbedding = false;
    const brain = await h.request("/v1/brains", { method: "POST", body: { name: "Reviews" } });
    expect(brain.status).toBe(201);
    brainId = ((await brain.json()) as { id: string }).id;
    sourceId = newId("source");
    candidates = [newId("page"), newId("page")];
    const vector = (await createFakeProvider().embed([claim])).vectors[0];
    for (const [index, id] of candidates.entries()) {
      await h.owner.query(
        `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, body, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, 'Original body', 'original')`,
        [id, h.tenants.a, h.subjects.a, brainId, `candidate-${index}`, `Candidate ${index}`],
      );
      await h.owner.query(
        `INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor)
         VALUES ($1, $2, 1, $3, '', 'Original body', 'compiler')`,
        [h.tenants.a, id, `Candidate ${index}`],
      );
      await h.owner.query(
        `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
         VALUES ($1, $2, 'fake-embedding', 1536, $3::vector, 'original')`,
        [h.tenants.a, id, JSON.stringify(vector)],
      );
    }
    await h.owner.query(
      `INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
       VALUES ($1, $2, $3, $4, 'note', $5, 'review-source')`,
      [sourceId, h.tenants.a, h.subjects.a, brainId, claim],
    );
    await h.owner.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1, $2, 'capture.compile', $3, $4)`,
      [h.tenants.a, brainId, JSON.stringify({ sourceId, brainId }), `compile:${sourceId}`],
    );
    const db = await import("@memtavi/db/client");
    worker = createWorker({
      withTenant: db.withTenant,
      tenantIds: [h.tenants.a],
      store: createFakeStore(),
      compiler: {
        chatModel: "fake-chat",
        embeddingModel: "fake-embedding",
        chatProvider: {
          chat: async (request) => {
            const input = JSON.parse(request.messages[1]?.content ?? "{}");
            if (input.chunks) {
              provider.queueChat(
                JSON.stringify({
                  facts: input.chunks.map(
                    (chunk: { chunkUuid: string; text: string }): ExtractedFact => ({
                      claim: chunk.text,
                      entities: [],
                      kind: "project_fact",
                      sensitivity: "none",
                      confidence: 0.9,
                      durability: 0.9,
                      impact: 0.9,
                      recurrence: 0.9,
                      novelty: 0.9,
                      futureUse: 0.9,
                      evidence: {
                        chunkUuid: chunk.chunkUuid,
                        charStart: 0,
                        charEnd: chunk.text.length,
                        quote: chunk.text,
                      },
                    }),
                  ),
                }),
              );
            } else {
              provider.queueChat(
                JSON.stringify({
                  title: input.existing.title,
                  summary: "Friday",
                  body: unchanged ? input.existing.body : `${input.existing.body}\n${claim}`,
                  changed: !unchanged,
                  contradictions: contradict
                    ? [
                        {
                          existingClaim: "Ships Monday",
                          newClaim: claim,
                          evidence: input.facts[0].evidence,
                        },
                      ]
                    : [],
                }),
              );
            }
            return provider.chat(request);
          },
        },
        embeddingProvider: {
          embed: async (texts) => {
            if (failEmbedding) throw new ProviderError("server_error", true, "private");
            return provider.embed(texts);
          },
        },
      },
      random: () => 0,
    });
    expect(await worker.runOnce()).toBe(true);
    const rows = await h.owner.query("SELECT id FROM routing_reviews WHERE brain_id = $1", [
      brainId,
    ]);
    expect(rows.rowCount).toBe(1);
    reviewId = rows.rows[0].id;
  });

  afterEach(async () => {
    await h?.close();
  });

  test("foreign tenants, subjects and brains cannot read or settle a review", async () => {
    const before = await placedState();
    for (const suffix of ["", `/${reviewId}/resolve`, `/${reviewId}/dismiss`]) {
      for (const options of [{ key: h.keys.b, subject: h.subjects.b }, { subject: h.subjects.b }]) {
        const response = await h.request(path(suffix), {
          ...options,
          ...(suffix
            ? { method: "POST", body: suffix.endsWith("resolve") ? { newPage: true } : {} }
            : {}),
        });
        expect(response.status).toBe(404);
      }
    }
    const other = await h.request("/v1/brains", { method: "POST", body: { name: "Other" } });
    const otherId = ((await other.json()) as { id: string }).id;
    for (const operation of ["resolve", "dismiss"]) {
      const response = await h.request(
        `/v1/brains/${otherId}/routing-reviews/${reviewId}/${operation}`,
        { method: "POST", body: operation === "resolve" ? { newPage: true } : {} },
      );
      expect(response.status).toBe(404);
    }
    expect(await placedState()).toEqual(before);
    expect(
      (await h.owner.query("SELECT status FROM routing_reviews WHERE id = $1", [reviewId])).rows[0]
        .status,
    ).toBe("open");
  });

  test("a review-band compile is listed with evidence, candidate titles and pagination", async () => {
    const response = await h.request(path());
    expect(response.status).toBe(200);
    const list = (await response.json()) as {
      items: Review[];
      total: number;
      limit: number;
      offset: number;
    };
    expect({ total: list.total, limit: list.limit, offset: list.offset }).toEqual({
      total: 1,
      limit: 50,
      offset: 0,
    });
    const review = list.items[0];
    if (!review) throw new Error("Missing listed review");
    expect(review.fact.claim).toBe(claim);
    expect(review.fact.evidence.quote).toBe(claim);
    expect(review.sourceId).toBe(sourceId);
    expect(review.status).toBe("open");
    expect(review.candidates.map((c) => c.title).sort()).toEqual(["Candidate 0", "Candidate 1"]);
    expect(Number.isNaN(Date.parse(review.createdAt))).toBe(false);
    expect((await h.request(path(), { query: { limit: 1, offset: 1 } })).status).toBe(200);
    expect(
      ((await (await h.request(path(), { query: { offset: 1 } })).json()) as { items: Review[] })
        .items,
    ).toEqual([]);
    expect(await placedState()).toEqual({ versions: 2, events: 0, links: 0, embeddings: 2 });
    expect(provider.calls.filter((c) => c.kind === "chat")).toHaveLength(1);
  });

  test("resolving onto a candidate reuses patching, evidence, usage and routed webhooks exactly once", async () => {
    const webhook = await h.request("/v1/webhooks", {
      method: "POST",
      body: {
        url: "https://review.example.invalid/hook",
        events: ["routed"],
      },
    });
    expect(webhook.status).toBe(201);
    expect((await resolve({ pageId: candidates[0], note: "Human choice" })).status).toBe(202);
    expect(await placedState()).toEqual({ versions: 2, events: 0, links: 0, embeddings: 2 });
    await worker.runOnce();
    const page = (
      await h.owner.query("SELECT body, version FROM pages WHERE id = $1", [candidates[0]])
    ).rows[0];
    expect(page.version).toBe(2);
    expect(page.body).toContain(claim);
    expect(await placedState()).toEqual({ versions: 3, events: 1, links: 1, embeddings: 2 });
    const event = (
      await h.owner.query(
        "SELECT action, from_version, to_version, ingest_source_id FROM change_events WHERE brain_id = $1",
        [brainId],
      )
    ).rows[0];
    expect(event).toEqual({
      action: "routed",
      from_version: 1,
      to_version: 2,
      ingest_source_id: sourceId,
    });
    const attached = (
      await h.owner.query(
        "SELECT page_id, ingest_source_id, chunk_uuids FROM page_sources WHERE tenant_id = $1",
        [h.tenants.a],
      )
    ).rows[0];
    const evidence = (
      await h.owner.query(
        "SELECT fact->'evidence'->>'chunkUuid' AS chunk FROM routing_reviews WHERE id = $1",
        [reviewId],
      )
    ).rows[0];
    expect(attached).toEqual({
      page_id: candidates[0],
      ingest_source_id: sourceId,
      chunk_uuids: [evidence.chunk],
    });
    const job = (
      await h.owner.query(
        "SELECT id, payload FROM jobs WHERE brain_id = $1 AND type = 'review.apply'",
        [brainId],
      )
    ).rows[0];
    expect(job.payload.applied).toBe(true);
    expect(
      (
        await h.owner.query("SELECT kind FROM usage_ledger WHERE job_id = $1 ORDER BY kind", [
          job.id,
        ])
      ).rows,
    ).toEqual([{ kind: "chat" }, { kind: "embedding" }]);
    expect(
      (
        await h.owner.query(
          "SELECT id FROM jobs WHERE brain_id = $1 AND type = 'webhook.deliver'",
          [brainId],
        )
      ).rowCount,
    ).toBe(1);
    await h.owner.query(
      "UPDATE jobs SET status = 'completed' WHERE brain_id = $1 AND type = 'webhook.deliver'",
      [brainId],
    );
    const calls = provider.calls.length;
    await h.owner.query("UPDATE jobs SET status = 'pending', available_at = now() WHERE id = $1", [
      job.id,
    ]);
    await worker.runOnce();
    expect((await placedState()).events).toBe(1);
    expect(provider.calls.length).toBe(calls);
    expect((await resolve()).status).toBe(409);
    expect((await h.request(path(`/${reviewId}/dismiss`), { method: "POST" })).status).toBe(409);
    const list = (await (await h.request(path(), { query: { status: "resolved" } })).json()) as {
      items: Review[];
    };
    expect(list.items[0]?.resolution).toBe("Human choice");
  });

  test("new-page resolution creates a sourced embedded page and a routed event", async () => {
    expect((await resolve({ newPage: true })).status).toBe(202);
    await worker.runOnce();
    const event = (
      await h.owner.query(
        "SELECT page_id, action, from_version FROM change_events WHERE brain_id = $1",
        [brainId],
      )
    ).rows[0];
    expect(event.action).toBe("routed");
    expect(event.from_version).toBeNull();
    expect(candidates).not.toContain(event.page_id);
    expect(await placedState()).toEqual({ versions: 3, events: 1, links: 1, embeddings: 3 });
  });

  test("non-candidates and inactive candidates are rejected without settling", async () => {
    const other = newId("page");
    await h.owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash)
      VALUES ($1, $2, $3, $4, 'other', 'Other', 'other')`,
      [other, h.tenants.a, h.subjects.a, brainId],
    );
    expect((await resolve({ pageId: other })).status).toBe(400);
    await h.owner.query("UPDATE pages SET status = 'archived' WHERE id = $1", [candidates[0]]);
    expect((await resolve()).status).toBe(400);
    await h.owner.query("UPDATE pages SET deletion_state = 'deleted' WHERE id = $1", [
      candidates[0],
    ]);
    expect((await resolve()).status).toBe(400);
    const list = (await (await h.request(path())).json()) as { items: Review[] };
    expect(list.items[0]?.candidates.map((c: { pageId: string }) => c.pageId)).toEqual([
      candidates[1],
    ]);
    expect(list.items[0]?.status).toBe("open");
    expect((await resolve({ pageId: candidates[1], newPage: true })).status).toBe(400);
    expect((await resolve({})).status).toBe(400);
    expect((await resolve({ newPage: false })).status).toBe(400);
  });

  test("dismiss retains the source and prevents any second settlement", async () => {
    const result = await h.request(path(`/${reviewId}/dismiss`), {
      method: "POST",
      body: { note: "Source only" },
    });
    expect(result.status).toBe(200);
    expect(((await result.json()) as Review).status).toBe("dismissed");
    expect((await resolve()).status).toBe(409);
    expect((await h.request(path(`/${reviewId}/dismiss`), { method: "POST" })).status).toBe(409);
    const source = await h.request(`/v1/brains/${brainId}/sources/${sourceId}`);
    expect(source.status).toBe(200);
    expect(((await source.json()) as { contentPreview: string }).contentPreview).toBe(claim);
    expect((await placedState()).events).toBe(0);
    expect(
      (
        await h.owner.query("SELECT id FROM jobs WHERE brain_id = $1 AND type = 'review.apply'", [
          brainId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  test("contradictions on resolve mark the chosen page contested", async () => {
    contradict = true;
    expect((await resolve()).status).toBe(202);
    await worker.runOnce();
    const page = (
      await h.owner.query("SELECT status, body, version FROM pages WHERE id = $1", [candidates[0]])
    ).rows[0];
    expect(page).toEqual({ status: "contested", body: "Original body", version: 2 });
    const event = (
      await h.owner.query("SELECT action, contradictions FROM change_events WHERE brain_id = $1", [
        brainId,
      ])
    ).rows[0];
    expect(event.action).toBe("routed");
    expect(event.contradictions[0].newClaim).toBe(claim);
  });

  test("viewers can list but cannot settle", async () => {
    const response = await h.request("/v1/api-keys", {
      method: "POST",
      body: { name: "Viewer", role: "viewer" },
    });
    const key = ((await response.json()) as { key: string }).key;
    expect((await h.request(path(), { key })).status).toBe(200);
    for (const operation of ["resolve", "dismiss"]) {
      expect(
        (
          await h.request(path(`/${reviewId}/${operation}`), {
            key,
            method: "POST",
            body: operation === "resolve" ? { newPage: true } : {},
          })
        ).status,
      ).toBe(403);
    }
    expect((await placedState()).events).toBe(0);
  });

  test("concurrent decisions accept exactly one and enqueue one placement", async () => {
    const results = await Promise.all([resolve(), resolve({ newPage: true })]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(
      (
        await h.owner.query("SELECT id FROM jobs WHERE brain_id = $1 AND type = 'review.apply'", [
          brainId,
        ])
      ).rowCount,
    ).toBe(1);
  });

  test("embedding failure rolls back placement and retries without duplicate versions", async () => {
    failEmbedding = true;
    expect((await resolve()).status).toBe(202);
    await worker.runOnce();
    expect((await placedState()).events).toBe(0);
    const job = (
      await h.owner.query(
        "SELECT id, status FROM jobs WHERE brain_id = $1 AND type = 'review.apply'",
        [brainId],
      )
    ).rows[0];
    expect(job.status).toBe("pending");
    expect(
      (await h.owner.query("SELECT id FROM usage_ledger WHERE job_id = $1", [job.id])).rowCount,
    ).toBe(1);
    failEmbedding = false;
    await h.owner.query("UPDATE jobs SET available_at = now() WHERE id = $1", [job.id]);
    await worker.runOnce();
    expect((await placedState()).versions).toBe(3);
    expect((await placedState()).events).toBe(1);
  });

  test("review placement protects a manually edited body", async () => {
    await h.owner.query(
      `UPDATE pages SET user_edited_at = '2026-11-10T00:00:00Z',
       last_compiled_at = '2026-11-09T00:00:00Z' WHERE id = $1`,
      [candidates[0]],
    );
    expect((await resolve()).status).toBe(202);
    await worker.runOnce();
    const page = (
      await h.owner.query(
        "SELECT body, version, user_edited_at > last_compiled_at AS protected FROM pages WHERE id = $1",
        [candidates[0]],
      )
    ).rows[0];
    expect(page.body).toStartWith("Original body\n\n## Updates");
    expect(page.body).toContain(claim);
    expect(page.protected).toBe(true);
    expect(page.version).toBe(2);
  });

  test("an unchanged patch attaches evidence without a redundant version or event", async () => {
    unchanged = true;
    expect((await resolve()).status).toBe(202);
    await worker.runOnce();
    expect(await placedState()).toEqual({ versions: 2, events: 0, links: 1, embeddings: 2 });
    const job = (
      await h.owner.query(
        "SELECT status, payload FROM jobs WHERE brain_id = $1 AND type = 'review.apply'",
        [brainId],
      )
    ).rows[0];
    expect(job.status).toBe("completed");
    expect(job.payload.applied).toBe(true);
  });

  test("a candidate deleted after acceptance fails placement without creating another page", async () => {
    expect((await resolve()).status).toBe(202);
    await h.owner.query("UPDATE pages SET deletion_state = 'deleted' WHERE id = $1", [
      candidates[0],
    ]);
    const calls = provider.calls.length;
    await worker.runOnce();
    expect(provider.calls.length).toBe(calls);
    expect((await placedState()).events).toBe(0);
    const job = (
      await h.owner.query("SELECT status FROM jobs WHERE brain_id = $1 AND type = 'review.apply'", [
        brainId,
      ])
    ).rows[0];
    expect(job.status).toBe("dead");
    expect(
      (await h.owner.query("SELECT id FROM pages WHERE brain_id = $1", [brainId])).rowCount,
    ).toBe(2);
  });

  test("budget caps stop review patching before another provider call", async () => {
    expect((await resolve()).status).toBe(202);
    await h.owner.query("INSERT INTO budget_caps (tenant_id, monthly_usd) VALUES ($1, 0)", [
      h.tenants.a,
    ]);
    const calls = provider.calls.length;
    await worker.runOnce();
    expect(provider.calls.length).toBe(calls);
    expect((await placedState()).events).toBe(0);
    expect(
      (
        await h.owner.query(
          "SELECT status FROM jobs WHERE brain_id = $1 AND type = 'review.apply'",
          [brainId],
        )
      ).rows[0].status,
    ).toBe("dead");
  });
});
