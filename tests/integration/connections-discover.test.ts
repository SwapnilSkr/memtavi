import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionPair } from "@memtavi/core/compile/connect";
import { promptVersion } from "@memtavi/core/compile/prompts";
import { createFakeProvider } from "@memtavi/llm/fake";
import { ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { contentHash } from "@memtavi/storage/keys";
import { CONNECTION_CANDIDATES_SQL, createWorker } from "@memtavi/worker";
import type { CompilerConfig } from "@memtavi/worker/types";
import { createHarness, type Harness } from "../support/harness";

describe("connections.discover", () => {
  let h: Harness;
  let db: typeof import("@memtavi/db/client");
  let brainId: string;
  let provider = createFakeProvider();
  let strength = "medium";
  let reasoning = "Atlas depends on Acme's delivery schedule.";
  let failure: ProviderError | undefined;
  let malformed = false;
  let requested: ConnectionPair[] = [];
  let beforeConnectionChat: (() => Promise<void>) | undefined;
  const model = "fake-connect-v1";
  const embeddingModel = "fake-embedding";
  const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
  const store = createFakeStore();

  function compiler(): CompilerConfig {
    return {
      chatModel: model,
      embeddingModel,
      embeddingProvider: {
        embed: async (texts) => ({
          ...(await provider.embed(texts)),
          vectors: texts.map((text) =>
            text === "Atlas depends on Acme." ? vector.map((_, i) => (i === 1 ? 1 : 0)) : vector,
          ),
        }),
      },
      chatProvider: {
        chat: async (request) => {
          const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
            chunks?: { chunkUuid: string; text: string }[];
            pairs?: ConnectionPair[];
          };
          if (input.pairs) {
            requested = input.pairs;
            await beforeConnectionChat?.();
            if (failure) throw failure;
            provider.queueChat(
              malformed
                ? "invalid JSON"
                : JSON.stringify({
                    connections: input.pairs.map(({ pageA, pageB }) => ({
                      pageAId: pageA.id,
                      pageBId: pageB.id,
                      strength,
                      reasoning,
                    })),
                  }),
            );
          } else {
            provider.queueChat(
              JSON.stringify({
                facts: input.chunks?.map((chunk) => ({
                  claim: chunk.text,
                  kind: "project_fact",
                  entities: [],
                  confidence: 1,
                  durability: 1,
                  impact: 1,
                  recurrence: 1,
                  novelty: 1,
                  futureUse: 1,
                  sensitivity: "none",
                  evidence: {
                    chunkUuid: chunk.chunkUuid,
                    charStart: 0,
                    charEnd: chunk.text.length,
                    quote: chunk.text,
                  },
                })),
              }),
            );
          }
          return provider.chat(request);
        },
      },
    };
  }

  function worker() {
    return createWorker({
      withTenant: db.withTenant,
      tenantIds: [h.tenants.a],
      store,
      compiler: compiler(),
      random: () => 0,
    });
  }

  async function createBrain(foreign = false) {
    const response = await h.request("/v1/brains", {
      method: "POST",
      key: foreign ? h.keys.b : h.keys.a,
      body: { name: "Connections", slug: `connections-${crypto.randomUUID()}` },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  async function seedPage(
    slug: string,
    options: {
      brain?: string;
      tenant?: string;
      model?: string;
      embedding?: number[];
      status?: string;
      deletion?: string;
      archived?: boolean;
    } = {},
  ) {
    const id = newId("page");
    const tenant = options.tenant ?? h.tenants.a;
    await h.owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, summary, body,
       content_hash, status, deletion_state, archived)
       VALUES ($1, $2, $3, $4, $5, $5, 'Acme builds Atlas', 'Atlas depends on Acme', $5, $6, $7, $8)`,
      [
        id,
        tenant,
        h.subjects.a,
        options.brain ?? brainId,
        slug,
        options.status ?? "active",
        options.deletion ?? "active",
        options.archived ?? false,
      ],
    );
    await h.owner.query(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       VALUES ($1, $2, $3, 1536, $4::vector, $5)`,
      [
        tenant,
        id,
        options.model ?? embeddingModel,
        JSON.stringify(options.embedding ?? vector),
        slug,
      ],
    );
    return id;
  }

  async function enqueue(pageIds: string[]) {
    const result = await h.owner.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1, $2, 'connections.discover', $3, $4) RETURNING id`,
      [
        h.tenants.a,
        brainId,
        JSON.stringify({ brainId, pageIds }),
        `connections-test:${crypto.randomUUID()}`,
      ],
    );
    return result.rows[0]?.id ?? "";
  }

  async function connections() {
    return (
      await h.owner.query<{
        id: string;
        page_a_id: string;
        page_b_id: string;
        strength: string;
        reasoning: string;
        similarity: number;
        acked_at: Date | null;
        source: string;
      }>(
        "SELECT * FROM connections WHERE tenant_id = $1 AND brain_id = $2 ORDER BY page_a_id, page_b_id",
        [h.tenants.a, brainId],
      )
    ).rows;
  }

  beforeEach(async () => {
    h = await createHarness();
    db = await import("@memtavi/db/client");
    brainId = await createBrain();
    provider = createFakeProvider();
    strength = "medium";
    reasoning = "Atlas depends on Acme's delivery schedule.";
    failure = undefined;
    malformed = false;
    requested = [];
    beforeConnectionChat = undefined;
  });

  afterEach(async () => {
    if (h) await h.close();
  });

  test("foreign tenant and brain pages produce no pairs before an in-scope batched discovery", async () => {
    const foreignBrain = await createBrain(true);
    const otherBrain = await createBrain();
    const foreign = await seedPage("foreign", { brain: foreignBrain, tenant: h.tenants.b });
    const other = await seedPage("other", { brain: otherBrain });
    const source = await seedPage("source");
    await enqueue([foreign, other]);
    await worker().runOnce();
    expect(provider.calls).toHaveLength(0);
    expect(await connections()).toHaveLength(0);
    for (const [id, key] of [
      [foreignBrain, h.keys.a],
      [otherBrain, h.keys.b],
    ] as const) {
      expect((await h.request(`/v1/brains/${id}/connections`, { key })).status).toBe(404);
    }
    const related = await seedPage("related");
    await enqueue([source, related]);
    await worker().runOnce();
    expect(requested).toHaveLength(1);
    expect((await connections()).map((row) => [row.page_a_id, row.page_b_id])).toEqual([
      [source, related].sort(),
    ]);
    const call = provider.calls.find((call) => call.kind === "chat");
    expect(call?.kind === "chat" && call.request.temperature).toBe(0);
  });

  test("a committed compile discovers a canonical connection with reasoning and graph", async () => {
    const instance = worker();
    for (const note of ["Acme builds Atlas.", "Atlas depends on Acme."]) {
      const response = await h.request(`/v1/brains/${brainId}/captures`, {
        method: "POST",
        body: { kind: "note", content: note },
      });
      expect(response.status).toBe(201);
      const stored = await h.owner.query<{ id: string; body_ref: string }>(
        "SELECT id, body_ref FROM ingest_sources WHERE brain_id = $1 AND content = $2",
        [brainId, note],
      );
      await store.put(stored.rows[0]?.body_ref ?? "", note, "text/plain; charset=utf-8");
      let completed = false;
      for (let i = 0; i < 5; i += 1) {
        const done = await h.owner.query(
          "SELECT id FROM ingest_sources WHERE id = $1 AND status = 'completed'",
          [stored.rows[0]?.id],
        );
        if (done.rowCount) {
          completed = true;
          break;
        }
        expect(await instance.runOnce()).toBe(true);
      }
      expect(completed).toBe(true);
    }
    const pages = (
      await h.owner.query<{ id: string }>("SELECT id FROM pages WHERE brain_id = $1 ORDER BY id", [
        brainId,
      ])
    ).rows;
    expect(pages).toHaveLength(2);
    for (let i = 0; i < 5; i += 1) {
      const pending = await h.owner.query(
        "SELECT id FROM jobs WHERE brain_id = $1 AND type = 'connections.discover' AND status <> 'completed'",
        [brainId],
      );
      if (!pending.rowCount) break;
      expect(await instance.runOnce()).toBe(true);
    }
    expect(
      (
        await h.owner.query(
          "SELECT id FROM jobs WHERE brain_id = $1 AND type = 'connections.discover' AND status <> 'completed'",
          [brainId],
        )
      ).rowCount,
    ).toBe(0);
    const rows = await connections();
    expect(rows).toHaveLength(1);
    expect([rows[0]?.page_a_id, rows[0]?.page_b_id]).toEqual(pages.map(({ id }) => id));
    expect(rows[0]?.reasoning).toBe(reasoning);
    const list = await h.request(`/v1/brains/${brainId}/connections`);
    expect(((await list.json()) as { items: { id: string }[] }).items[0]?.id).toBe(rows[0]?.id);
    const graph = await h.request(`/v1/brains/${brainId}/graph`);
    expect(
      ((await graph.json()) as { edges: { connectionId: string }[] }).edges[0]?.connectionId,
    ).toBe(rows[0]?.id);
    const job = await h.owner.query(
      "SELECT payload FROM jobs WHERE brain_id = $1 AND type = 'connections.discover'",
      [brainId],
    );
    expect(job.rows.find((row) => row.payload.connectionPrompt)?.payload.connectionPrompt).toEqual({
      model,
      promptHash: promptVersion("connect"),
    });
    expect(
      (
        await h.owner.query(
          "SELECT model, input_tokens, output_tokens, cost_usd FROM usage_ledger WHERE job_id IN (SELECT id FROM jobs WHERE brain_id = $1 AND type = 'connections.discover')",
          [brainId],
        )
      ).rows[0]?.model,
    ).toBe(model);
  });

  test("noise creates no connection and leaves an existing auto pair acknowledged", async () => {
    const a = await seedPage("a");
    const b = await seedPage("b");
    strength = "noise";
    await enqueue([a]);
    await worker().runOnce();
    expect(await connections()).toHaveLength(0);
    strength = "weak";
    await enqueue([a, b]);
    await worker().runOnce();
    await h.owner.query(
      "UPDATE connections SET acked_at = '2026-11-07T00:00:00Z' WHERE brain_id = $1",
      [brainId],
    );
    const before = await connections();
    strength = "noise";
    await enqueue([a]);
    await worker().runOnce();
    expect(await connections()).toEqual(before);
  });

  test("a same-brain compile completes while the discovery provider is blocked", async () => {
    const source = await seedPage("source");
    await seedPage("related");
    const discoveryId = await enqueue([source]);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    beforeConnectionChat = async () => {
      entered.resolve();
      await release.promise;
    };
    const discovering = worker().runOnce();
    await entered.promise;
    try {
      const note = "A separate durable project fact.";
      const sourceId = newId("source");
      await h.owner.query(
        `INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
         VALUES ($1, $2, $3, $4, 'note', $5, $6)`,
        [sourceId, h.tenants.a, h.subjects.a, brainId, note, contentHash(note)],
      );
      await h.owner.query(
        `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
         VALUES ($1, $2, 'capture.compile', $3, $4)`,
        [h.tenants.a, brainId, JSON.stringify({ brainId, sourceId }), `compile:${sourceId}`],
      );
      const compiling = createWorker({
        withTenant: (tenant, callback, subject) =>
          db.withTenant(
            tenant,
            async (client) => {
              await client.query("SET LOCAL statement_timeout = '1500ms'");
              return callback(client);
            },
            subject,
          ),
        tenantIds: [h.tenants.a],
        store,
        compiler: compiler(),
      });
      expect(await compiling.runOnce()).toBe(true);
      expect(
        (await h.owner.query("SELECT status FROM ingest_sources WHERE id = $1", [sourceId])).rows[0]
          ?.status,
      ).toBe("completed");
      expect(
        (await h.owner.query("SELECT status FROM jobs WHERE id = $1", [discoveryId])).rows[0]
          ?.status,
      ).toBe("running");
    } finally {
      release.resolve();
      await discovering;
    }
    expect(await connections()).toHaveLength(1);
  });

  test.each(["deleted page", "manual pair", "deleted brain", "new acknowledgement"] as const)(
    "rechecks %s after the provider returns",
    async (change) => {
      const a = await seedPage("a");
      await seedPage("b");
      await enqueue([a]);
      await worker().runOnce();
      const before = (await connections())[0];
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      beforeConnectionChat = async () => {
        entered.resolve();
        await release.promise;
      };
      reasoning = "A new automatic explanation.";
      const jobId = await enqueue([a]);
      const discovering = worker().runOnce();
      await entered.promise;
      try {
        if (change === "deleted page") {
          await h.owner.query("UPDATE pages SET deletion_state = 'deleted' WHERE id = $1", [a]);
        } else if (change === "manual pair") {
          await h.owner.query(
            "UPDATE connections SET source = 'manual', reasoning = 'Human explanation' WHERE id = $1",
            [before?.id],
          );
        } else if (change === "deleted brain") {
          await h.owner.query("UPDATE brains SET deletion_state = 'deleted' WHERE id = $1", [
            brainId,
          ]);
        } else {
          await h.owner.query(
            "UPDATE connections SET acked_at = '2026-11-07T00:00:00Z' WHERE id = $1",
            [before?.id],
          );
        }
      } finally {
        release.resolve();
        await discovering;
      }
      const after = (await connections())[0];
      expect(after?.id).toBe(before?.id);
      if (change === "manual pair") {
        expect(after?.source).toBe("manual");
        expect(after?.reasoning).toBe("Human explanation");
      } else if (change === "new acknowledgement") {
        expect(after?.acked_at?.toISOString()).toBe("2026-11-07T00:00:00.000Z");
        expect(after?.reasoning).toBe(reasoning);
      } else {
        expect(after).toEqual(before);
      }
      expect(
        (await h.owner.query("SELECT status FROM jobs WHERE id = $1", [jobId])).rows[0]?.status,
      ).toBe("completed");
    },
  );

  test("queued discovery does not delay capture or snapshot work", async () => {
    const a = await seedPage("a");
    await seedPage("b");
    const discoveryId = await enqueue([a]);
    await h.owner.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1, $2, 'capture.compile', $3, $4),
         ($1, $2, 'score.snapshot', $5, $6)`,
      [
        h.tenants.a,
        brainId,
        JSON.stringify({ brainId, sourceId: newId("source") }),
        `priority-compile:${brainId}`,
        JSON.stringify({ brainId }),
        `priority-snapshot:${brainId}`,
      ],
    );
    const instance = worker();
    expect(await instance.runOnce()).toBe(true);
    expect(await instance.runOnce()).toBe(true);
    expect(provider.calls).toHaveLength(0);
    expect(
      (await h.owner.query("SELECT status FROM jobs WHERE id = $1", [discoveryId])).rows[0]?.status,
    ).toBe("pending");
    expect(
      (await h.owner.query("SELECT id FROM score_snapshots WHERE brain_id = $1", [brainId]))
        .rowCount,
    ).toBe(1);
    expect(await instance.runOnce()).toBe(true);
    expect(await connections()).toHaveLength(1);
  });

  test("reruns update without duplicates, preserve ack unless strength rises, and replay costs nothing", async () => {
    const a = await seedPage("a");
    const b = await seedPage("b");
    await enqueue([b, a]);
    await worker().runOnce();
    const id = (await connections())[0]?.id;
    await h.owner.query("UPDATE connections SET acked_at = '2026-11-07T00:00:00Z' WHERE id = $1", [
      id,
    ]);
    reasoning = "Both pages describe Atlas's dependency on Acme.";
    const jobId = await enqueue([a]);
    await worker().runOnce();
    expect(await connections()).toHaveLength(1);
    expect((await connections())[0]?.id).toBe(id);
    expect((await connections())[0]?.reasoning).toBe(reasoning);
    expect((await connections())[0]?.acked_at?.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    const calls = provider.calls.length;
    await h.owner.query("UPDATE jobs SET status = 'pending' WHERE id = $1", [jobId]);
    await worker().runOnce();
    expect(provider.calls).toHaveLength(calls);
    strength = "strong";
    await enqueue([a]);
    await worker().runOnce();
    expect((await connections())[0]?.acked_at).toBeNull();
    expect((await connections())[0]?.strength).toBe("strong");
  });

  test("manual connections are excluded before paying and are never changed", async () => {
    const ids = [await seedPage("a"), await seedPage("b")].sort();
    await h.owner.query(
      `INSERT INTO connections (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source, acked_at)
      VALUES ($1, $2, $3, $4, $5, 0.7, 'strong', 'Manual reason', 'manual', '2026-11-07T00:00:00Z')`,
      [newId("connection"), h.tenants.a, brainId, ...ids],
    );
    const before = await connections();
    await enqueue(ids);
    await worker().runOnce();
    expect(provider.calls).toHaveLength(0);
    expect(await connections()).toEqual(before);
  });

  test("selects at most eight with the same model, active pages, similarity floor and stable ties", async () => {
    const source = await seedPage("source");
    const targets: string[] = [];
    for (let i = 0; i < 10; i += 1) targets.push(await seedPage(`target-${i}`));
    await seedPage("archived-status", { status: "archived" });
    await seedPage("archived-flag", { archived: true });
    await seedPage("deleted", { deletion: "deleted" });
    await seedPage("wrong-model", { model: "other-model" });
    await seedPage("noise", { embedding: vector.map((n) => -n) });
    await enqueue([source]);
    await worker().runOnce();
    expect(requested).toHaveLength(8);
    expect(
      requested.map(({ pageA, pageB }) => (pageA.id === source ? pageB.id : pageA.id)).sort(),
    ).toEqual(targets.slice(0, 8).sort());
    const plan = await db.withTenant(h.tenants.a, (client) =>
      client.query(`EXPLAIN (ANALYZE, BUFFERS) ${CONNECTION_CANDIDATES_SQL}`, [
        source,
        h.tenants.a,
        brainId,
        embeddingModel,
        0.45,
        8,
      ]),
    );
    process.stdout.write(
      `CONNECTION_CANDIDATES_SQL plan\n${plan.rows.map((row) => row["QUERY PLAN"]).join("\n")}\n`,
    );
    const recheckPlan = await db.withTenant(h.tenants.a, (client) =>
      client.query(
        `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM pages
         WHERE tenant_id = $1 AND brain_id = $2 AND id = ANY($3::text[])
           AND deletion_state = 'active' AND status IN ('active', 'contested') AND NOT archived
         ORDER BY id FOR SHARE`,
        [h.tenants.a, brainId, [source, targets[0]]],
      ),
    );
    process.stdout.write(
      `Connection page recheck plan\n${recheckPlan.rows.map((row) => row["QUERY PLAN"]).join("\n")}\n`,
    );
    expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("Limit");
  });

  test("a transient discovery failure preserves the committed compile and retries independently", async () => {
    const note = "Acme builds Atlas.";
    const sourceId = newId("source");
    await h.owner.query(
      `INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
      VALUES ($1, $2, $3, $4, 'note', $5, $6)`,
      [sourceId, h.tenants.a, h.subjects.a, brainId, note, contentHash(note)],
    );
    await h.owner.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
      VALUES ($1, $2, 'capture.compile', $3, $4)`,
      [h.tenants.a, brainId, JSON.stringify({ brainId, sourceId }), `compile:${sourceId}`],
    );
    await worker().runOnce();
    await seedPage("related");
    failure = new ProviderError("server_error", true, "Private provider response");
    for (let i = 0; i < 3; i += 1) {
      const attempted = await h.owner.query(
        "SELECT id FROM jobs WHERE brain_id = $1 AND type = 'connections.discover' AND attempts > 0",
        [brainId],
      );
      if (attempted.rowCount) break;
      expect(await worker().runOnce()).toBe(true);
    }
    const result = await h.owner.query("SELECT status FROM ingest_sources WHERE id = $1", [
      sourceId,
    ]);
    expect(result.rows[0]?.status).toBe("completed");
    expect(
      (
        await h.owner.query(
          "SELECT id FROM page_versions WHERE tenant_id = $1 AND page_id IN (SELECT id FROM pages WHERE brain_id = $2)",
          [h.tenants.a, brainId],
        )
      ).rowCount,
    ).toBe(1);
    const job = (
      await h.owner.query(
        "SELECT id, status, attempts, last_error FROM jobs WHERE brain_id = $1 AND type = 'connections.discover'",
        [brainId],
      )
    ).rows[0];
    expect(job?.status).toBe("pending");
    expect(job?.last_error).toBe("Connection provider failed");
    failure = undefined;
    await h.owner.query("UPDATE jobs SET available_at = now() WHERE id = $1", [job?.id]);
    await worker().runOnce();
    expect(await connections()).toHaveLength(1);
  });

  test("invalid output is permanent with cost and prompt metadata retained", async () => {
    const a = await seedPage("a");
    await seedPage("b");
    malformed = true;
    const id = await enqueue([a]);
    await worker().runOnce();
    const job = (await h.owner.query("SELECT status, payload FROM jobs WHERE id = $1", [id]))
      .rows[0];
    expect(job?.status).toBe("dead");
    expect(job?.payload.connectionPrompt.promptHash).toBe(promptVersion("connect"));
    expect(
      (await h.owner.query("SELECT id FROM usage_ledger WHERE job_id = $1", [id])).rowCount,
    ).toBe(1);
    expect(await connections()).toHaveLength(0);
  });

  test("a hard budget cap stops discovery before a provider call", async () => {
    const a = await seedPage("a");
    await seedPage("b");
    const id = await enqueue([a]);
    await h.owner.query(
      "INSERT INTO budget_caps (tenant_id, monthly_usd, hard_stop) VALUES ($1, 0, true)",
      [h.tenants.a],
    );
    try {
      await worker().runOnce();
      expect(provider.calls).toHaveLength(0);
      expect(
        (await h.owner.query("SELECT status FROM jobs WHERE id = $1", [id])).rows[0]?.status,
      ).toBe("dead");
    } finally {
      await h.owner.query("DELETE FROM budget_caps WHERE tenant_id = $1", [h.tenants.a]);
    }
  });
});
