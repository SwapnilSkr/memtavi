import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ExtractedFact } from "@memtavi/core/compile/schemas";
import { chatCostUsd, embeddingCostUsd } from "@memtavi/llm/cost";
import { createFakeProvider } from "@memtavi/llm/fake";
import { type ChatRequest, ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { contentHash, sourceKey } from "@memtavi/storage/keys";
import { createWorker } from "@memtavi/worker";
import { CANDIDATES_SQL, compileCapture, ENTITY_PAGES_SQL } from "@memtavi/worker/compile";
import type { CompilerConfig, RoutingEvent } from "@memtavi/worker/types";
import { Pool, type PoolClient } from "pg";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe("capture.compile", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const store = createFakeStore();
  const tenantId = crypto.randomUUID();
  const foreignTenantId = crypto.randomUUID();
  const subjectId = crypto.randomUUID();
  const chatModel = "fake-chat";
  const embeddingModel = "fake-embedding";
  let brainId = "";
  let foreignBrainId = "";
  let foreignSourceId = "";
  let authorized = false;
  let sourceId = "";
  let jobId = "";
  let note = "The compiler preserves evidence.";
  let score = 0.9;
  let provider = createFakeProvider();
  let patchResponse: string | undefined;
  let failChat: ProviderError | undefined;
  let failPageEmbedding = false;
  let factEntities: string[] = [];
  let routing: RoutingEvent[] = [];
  let entitiesByClaim: Record<string, string[]> = {};
  const batchClaims = ["Alpha ships. ", "Beta builds. ", "Gamma tests. "].map((claim) =>
    claim.repeat(180).trim(),
  );
  const batchText = batchClaims.join("\n\n");

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

  function compiler(): CompilerConfig {
    return {
      chatModel,
      embeddingModel,
      chatProvider: {
        chat: async (request: ChatRequest) => {
          if (failChat) throw failChat;
          const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
            chunks?: { chunkUuid: string; text: string }[];
          };
          if (input.chunks) {
            const facts = input.chunks.map(
              (chunk): ExtractedFact => ({
                claim: chunk.text.trim(),
                kind: "project_fact",
                entities: entitiesByClaim[chunk.text.trim()] ?? factEntities,
                confidence: score,
                durability: score,
                impact: score,
                recurrence: score,
                novelty: score,
                futureUse: score,
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
          } else if (patchResponse !== undefined) provider.queueChat(patchResponse);
          return provider.chat(request);
        },
      },
      embeddingProvider: {
        embed: async (texts) => {
          if (failPageEmbedding && texts.some((text) => text.includes("## Sources"))) {
            throw new ProviderError("server_error", true, "private upstream error");
          }
          return provider.embed(texts);
        },
      },
    };
  }

  function worker() {
    return createWorker({
      withTenant,
      tenantIds: [tenantId],
      store,
      compiler: compiler(),
      handlers: {
        "capture.compile": (context) =>
          compileCapture({ ...context, onRouting: (event) => routing.push(event) }),
      },
      random: () => 0,
      fetchDocument: async () => {
        throw new Error("Network is forbidden");
      },
    });
  }

  async function capture(text = note, bodyInStore = false) {
    sourceId = newId("source");
    const bodyRef = bodyInStore ? sourceKey({ tenantId, sourceId, body: text }) : null;
    if (bodyRef) await store.put(bodyRef, text, "text/plain");
    await owner.query(
      `INSERT INTO ingest_sources
       (id, tenant_id, subject_id, brain_id, kind, content, content_hash, body_ref)
       VALUES ($1, $2, $3, $4, 'note', $5, $6, $7)`,
      [
        sourceId,
        tenantId,
        subjectId,
        brainId,
        bodyRef ? "preview" : text,
        contentHash(text),
        bodyRef,
      ],
    );
    const job = await owner.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1, $2, 'capture.compile', $3, $4) RETURNING id`,
      [tenantId, brainId, JSON.stringify({ sourceId, brainId }), `compile:${sourceId}`],
    );
    jobId = job.rows[0]?.id ?? "";
  }

  async function seedCandidate(
    slug: string,
    text = note,
    model = embeddingModel,
    entities: readonly string[] = [],
  ) {
    const pageId = newId("page");
    const vector = (await createFakeProvider().embed([text])).vectors[0];
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, summary, body, content_hash, entities)
       VALUES ($1, $2, $3, $4, $5, 'Original', 'Old summary', 'Human body', $6, $7)`,
      [
        pageId,
        tenantId,
        subjectId,
        brainId,
        slug,
        contentHash("Original\nOld summary\nHuman body"),
        entities,
      ],
    );
    await owner.query(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       SELECT tenant_id, id, $3, 1536, $4::vector, content_hash FROM pages
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, pageId, model, JSON.stringify(vector)],
    );
    await owner.query(
      `INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor)
       VALUES ($1, $2, 1, 'Original', 'Old summary', 'Human body', 'user')`,
      [tenantId, pageId],
    );
    return pageId;
  }

  async function counts() {
    const result = await owner.query<Record<string, number>>(
      `SELECT
       (SELECT count(*)::int FROM pages WHERE tenant_id = $1 AND brain_id = $2) AS pages,
       (SELECT count(*)::int FROM page_versions v JOIN pages p ON p.id = v.page_id
         WHERE v.tenant_id = $1 AND p.brain_id = $2) AS versions,
       (SELECT count(*)::int FROM page_sources WHERE tenant_id = $1 AND ingest_source_id = $3) AS sources,
       (SELECT count(*)::int FROM change_events WHERE tenant_id = $1 AND brain_id = $2) AS events,
       (SELECT count(*)::int FROM page_embeddings e JOIN pages p ON p.id = e.page_id
         WHERE e.tenant_id = $1 AND p.brain_id = $2) AS embeddings,
       (SELECT count(*)::int FROM usage_ledger WHERE tenant_id = $1 AND job_id = $4) AS ledger,
       (SELECT count(*)::int FROM routing_reviews WHERE tenant_id = $1 AND brain_id = $2) AS reviews`,
      [tenantId, brainId, sourceId, jobId],
    );
    return result.rows[0];
  }

  beforeAll(async () => {
    if (!ownerUrl || !appUrl) throw new Error("Both test database URLs are required");
    const db = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(db.rows[0]?.name ?? "")) {
      throw new Error("Compiler fixtures require a disposable memtavi_test database");
    }
    const role = await application.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    authorized = true;
    await owner.query(
      "INSERT INTO tenants (id, name, slug) VALUES ($1::uuid, 'Compiler', $1::uuid::text), ($2::uuid, 'Foreign compiler', $2::uuid::text)",
      [tenantId, foreignTenantId],
    );
    await owner.query(
      "INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1, $3), ($2, $3)",
      [tenantId, foreignTenantId, subjectId],
    );
    foreignBrainId = newId("brain");
    foreignSourceId = newId("source");
    await owner.query(
      "INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, 'Foreign', 'foreign')",
      [foreignBrainId, foreignTenantId, subjectId],
    );
    await owner.query(
      "INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, 'note', 'Foreign body', 'foreign')",
      [foreignSourceId, foreignTenantId, subjectId, foreignBrainId],
    );
  });

  beforeEach(async () => {
    brainId = newId("brain");
    note = "The compiler preserves evidence.";
    score = 0.9;
    provider = createFakeProvider();
    patchResponse = undefined;
    failChat = undefined;
    failPageEmbedding = false;
    factEntities = [];
    routing = [];
    entitiesByClaim = {};
    await owner.query(
      "INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, 'Compiler', $1)",
      [brainId, tenantId, subjectId],
    );
  });

  afterAll(async () => {
    if (authorized)
      await owner.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [
        [tenantId, foreignTenantId],
      ]);
    await Promise.all([owner.end(), application.end()]);
  });

  test("foreign and deleted sources are no-ops before compiling a stored note and replaying it", async () => {
    await capture(note, true);
    await owner.query("UPDATE jobs SET payload = $2 WHERE id = $1", [
      jobId,
      JSON.stringify({ sourceId: foreignSourceId, brainId }),
    ]);
    expect(await worker().runOnce()).toBe(true);
    expect(provider.calls).toHaveLength(0);
    expect(
      (await owner.query("SELECT status FROM ingest_sources WHERE id = $1", [foreignSourceId]))
        .rows[0]?.status,
    ).toBe("pending");
    await owner.query("UPDATE ingest_sources SET deleted_at = now() WHERE id = $1", [sourceId]);
    await owner.query("UPDATE jobs SET status = 'pending', payload = $2 WHERE id = $1", [
      jobId,
      JSON.stringify({ sourceId, brainId }),
    ]);
    await worker().runOnce();
    expect(provider.calls).toHaveLength(0);
    await owner.query("UPDATE ingest_sources SET deleted_at = NULL WHERE id = $1", [sourceId]);
    await owner.query("UPDATE jobs SET status = 'pending' WHERE id = $1", [jobId]);
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 1,
      versions: 1,
      sources: 1,
      events: 1,
      embeddings: 1,
      ledger: 3,
      reviews: 0,
    });
    const source = (
      await owner.query(
        "SELECT status, affected_page_ids, chunk_uuids, compiled_at FROM ingest_sources WHERE id = $1",
        [sourceId],
      )
    ).rows[0];
    expect(source?.status).toBe("completed");
    expect(source?.compiled_at).toBeInstanceOf(Date);
    expect(source?.affected_page_ids).toHaveLength(1);
    const chunk = (
      await owner.query(
        "SELECT id, text, body_ref, char_start, char_end FROM source_chunks WHERE source_id = $1",
        [sourceId],
      )
    ).rows[0];
    expect(chunk?.text).toBeNull();
    expect(chunk?.char_start).toBe(0);
    expect(chunk?.char_end).toBe(note.length);
    expect(await new Response(await store.get(chunk?.body_ref as string)).text()).toBe(note);
    const page = (
      await owner.query(
        "SELECT id, title, summary, body, version, page_type, entities FROM pages WHERE brain_id = $1",
        [brainId],
      )
    ).rows[0];
    expect(page?.title).toBe(note);
    expect(page?.summary).toBe(note);
    expect(page?.version).toBe(1);
    expect(page?.page_type).toBe("topic");
    expect(page?.entities).toEqual([]);
    expect(page?.body).toContain(`## Sources\n- ${chunk?.id}:0-${note.length}`);
    const usage = await owner.query<{
      kind: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: string;
    }>("SELECT kind, input_tokens, output_tokens, cost_usd FROM usage_ledger WHERE job_id = $1", [
      jobId,
    ]);
    for (const row of usage.rows) {
      expect(Number(row.cost_usd)).toBeCloseTo(
        row.kind === "chat"
          ? chatCostUsd(row.input_tokens, row.output_tokens)
          : embeddingCostUsd(row.input_tokens),
        8,
      );
      expect(row.input_tokens).toBeGreaterThan(0);
    }
    const calls = provider.calls.length;
    await owner.query("UPDATE jobs SET status = 'pending' WHERE id = $1", [jobId]);
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 1,
      versions: 1,
      sources: 1,
      events: 1,
      embeddings: 1,
      ledger: 3,
      reviews: 0,
    });
    expect(provider.calls).toHaveLength(calls);
    expect(
      (
        await owner.query("SELECT count(*)::int AS n FROM source_chunks WHERE source_id = $1", [
          sourceId,
        ])
      ).rows[0]?.n,
    ).toBe(1);
  });

  test("source-only facts incur extraction usage without creating pages", async () => {
    score = 0.1;
    await capture();
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 0,
      versions: 0,
      sources: 0,
      events: 0,
      embeddings: 0,
      ledger: 1,
      reviews: 0,
    });
  });

  test("provisional facts compile and paragraph offsets still reference the original body", async () => {
    score = 0.5;
    note = `${"First paragraph. ".repeat(100)}\r\n\r\n${"Second paragraph. ".repeat(100)}`;
    await capture(note, true);
    await worker().runOnce();
    const chunks = await owner.query<{
      text: null;
      body_ref: string;
      char_start: number;
      char_end: number;
    }>(
      "SELECT text, body_ref, char_start, char_end FROM source_chunks WHERE source_id = $1 ORDER BY ordinal",
      [sourceId],
    );
    expect(chunks.rows.length).toBeGreaterThan(1);
    let reconstructed = "";
    for (const chunk of chunks.rows) {
      const text = await new Response(await store.get(chunk.body_ref)).text();
      expect(text).toBe(note.slice(chunk.char_start, chunk.char_end));
      expect(chunk.text).toBeNull();
      reconstructed += text;
    }
    expect(reconstructed).toBe(note);
    expect((await counts())?.pages).toBe(2);
    expect(provider.calls.filter((call) => call.kind === "chat")).toHaveLength(1);
  });

  test("concurrent replays of one source cannot duplicate compiler writes", async () => {
    await capture();
    await owner.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       SELECT tenant_id, brain_id, type, payload, idempotency_key || ':replay' FROM jobs WHERE id = $1`,
      [jobId],
    );
    const instance = worker();
    expect(await Promise.all([instance.runOnce(), instance.runOnce()])).toEqual([true, true]);
    expect(await counts()).toEqual({
      pages: 1,
      versions: 1,
      sources: 1,
      events: 1,
      embeddings: 1,
      ledger: 3,
      reviews: 0,
    });
    expect(provider.calls.filter((call) => call.kind === "chat")).toHaveLength(1);
  });

  test("near-tied real candidates create a routing review without a new page or version", async () => {
    const candidates = [await seedCandidate("a"), await seedCandidate("b")];
    await capture();
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 2,
      versions: 2,
      sources: 0,
      events: 0,
      embeddings: 2,
      ledger: 2,
      reviews: 1,
    });
    const review = (
      await owner.query(
        "SELECT fact, candidate_page_ids, best_gap, status FROM routing_reviews WHERE brain_id = $1",
        [brainId],
      )
    ).rows[0];
    expect(review?.candidate_page_ids).toEqual(candidates);
    expect(review?.best_gap).toBe(0);
    expect(review?.status).toBe("open");
    expect(review?.fact.evidence.quote).toBe(note);
  });

  test("facts from different sources consolidate by entity while another entity creates a page", async () => {
    factEntities = [" AcMe ", "ACME"];
    await capture("Acme launches its compiler.");
    await worker().runOnce();
    const firstSourceId = sourceId;
    const first = (
      await owner.query("SELECT id, title, page_type, entities FROM pages WHERE brain_id = $1", [
        brainId,
      ])
    ).rows[0];
    expect(first?.title).toBe("AcMe");
    expect(first?.page_type).toBe("entity");
    expect(first?.entities).toEqual(["acme"]);
    factEntities = ["acme", " Compiler "];
    patchResponse = JSON.stringify({
      title: "AcMe",
      summary: "Acme launches and maintains its compiler.",
      body: "Acme launches its compiler. Acme maintains the compiler.",
      changed: true,
      contradictions: [],
    });
    await capture("Acme maintains the compiler.");
    await worker().runOnce();
    expect((await counts())?.pages).toBe(1);
    expect((await counts())?.versions).toBe(2);
    expect(routing[1]?.best).toBeLessThan(0.45);
    expect(routing[1]).toMatchObject({
      action: "place",
      reason: "entity",
      entityOverlap: 1,
      chosenPageId: first?.id,
    });
    const consolidated = (
      await owner.query("SELECT entities, body, version FROM pages WHERE id = $1", [first?.id])
    ).rows[0];
    expect(consolidated?.entities).toEqual(["acme", "compiler"]);
    expect(consolidated?.body).toContain("Acme maintains the compiler.");
    expect(consolidated?.version).toBe(2);
    const sources = await owner.query<{ ingest_source_id: string }>(
      "SELECT ingest_source_id FROM page_sources WHERE page_id = $1 ORDER BY ingest_source_id",
      [first?.id],
    );
    expect(sources.rows.map((row) => row.ingest_source_id)).toEqual(
      [firstSourceId, sourceId].sort(),
    );
    factEntities = ["Beta"];
    await capture("Beta builds a calendar.");
    await worker().runOnce();
    expect((await counts())?.pages).toBe(2);
    expect(routing[2]).toMatchObject({ action: "new", reason: "new", entityOverlap: 0 });
  });

  test("new routing picks the strictly greatest entity overlap without requiring an embedding", async () => {
    factEntities = [" Acme ", "Beta"];
    await seedCandidate("a-less-overlap", note, "other-model", ["acme"]);
    const target = await seedCandidate("z-more-overlap", note, "other-model", ["acme", "beta"]);
    patchResponse = JSON.stringify({
      title: "Original",
      summary: "Old summary",
      body: "Human body",
      changed: false,
      contradictions: [],
    });
    await capture();
    await worker().runOnce();
    expect((await counts())?.pages).toBe(2);
    expect(routing[0]).toMatchObject({
      action: "place",
      reason: "entity",
      entityOverlap: 2,
      candidateCount: 0,
      chosenPageId: target,
    });
  });

  test("equal entity overlaps on new routing create a page with the existing slug fallback", async () => {
    factEntities = ["Acme"];
    await seedCandidate("acme", note, "other-model", ["acme"]);
    await seedCandidate("another-acme", note, "other-model", ["acme"]);
    await capture();
    await worker().runOnce();
    expect((await counts())?.pages).toBe(3);
    expect(routing[0]).toMatchObject({ action: "new", reason: "new", entityOverlap: 1 });
    const created = (
      await owner.query("SELECT slug FROM pages WHERE brain_id = $1 AND title = 'Acme'", [brainId])
    ).rows[0];
    expect(created?.slug).toBe(`acme-${contentHash(`${sourceId}\n0\n${note}`).slice(0, 12)}`);
  });

  test("review places the only entity-sharing candidate and ignores matches outside the candidates", async () => {
    factEntities = [" AcMe ", "ACME"];
    await seedCandidate("a-unrelated", note, embeddingModel, ["beta"]);
    const target = await seedCandidate("b-acme", note, embeddingModel, ["acme"]);
    await seedCandidate("outside-candidates", note, "other-model", ["acme"]);
    patchResponse = JSON.stringify({
      title: "Acme",
      summary: note,
      body: "Acme update",
      changed: true,
      contradictions: [],
    });
    await capture();
    await worker().runOnce();
    expect((await counts())?.reviews).toBe(0);
    expect((await counts())?.pages).toBe(3);
    expect((await counts())?.versions).toBe(4);
    expect(routing[0]).toMatchObject({
      action: "place",
      reason: "entity",
      entityOverlap: 1,
      chosenPageId: target,
      best: 1,
      second: 1,
      gap: 0,
      candidateCount: 2,
    });
  });

  test.each([
    { entities: ["beta"], overlap: 1 },
    { entities: ["acme", "beta"], overlap: 2 },
  ])("review retains two entity-sharing candidates even with overlap $overlap", async (fixture) => {
    factEntities = ["Acme", "Beta"];
    const candidates = [
      await seedCandidate("a", note, embeddingModel, fixture.entities),
      await seedCandidate("b", note, embeddingModel, ["acme"]),
    ];
    await capture();
    await worker().runOnce();
    expect((await counts())?.reviews).toBe(1);
    expect((await counts())?.pages).toBe(2);
    expect((await counts())?.versions).toBe(2);
    expect(provider.calls.filter((call) => call.kind === "chat")).toHaveLength(1);
    expect(routing[0]).toMatchObject({
      action: "review",
      reason: "score",
      entityOverlap: fixture.overlap,
      candidateIds: candidates,
    });
  });

  test.each([{ entities: [] }, { entities: [" ", "\t"] }])(
    "facts without usable entities retain topic creation: %j",
    async ({ entities }) => {
      factEntities = [...entities];
      note = `  ${"Claim ".repeat(30)}  `;
      await capture();
      await worker().runOnce();
      const page = (
        await owner.query(
          "SELECT title, summary, entities, page_type FROM pages WHERE brain_id = $1",
          [brainId],
        )
      ).rows[0];
      expect(page?.title).toBe(note.trim().slice(0, 120));
      expect(page?.summary).toBe(note.trim());
      expect(page?.entities).toEqual([]);
      expect(page?.page_type).toBe("topic");
      expect(routing[0]).toMatchObject({ action: "new", reason: "new", entityOverlap: 0 });
    },
  );

  test("created entity lists are trimmed, lowercased, deduplicated and capped at twenty", async () => {
    factEntities = [
      " AcMe ",
      "ACME",
      " ",
      ...Array.from({ length: 25 }, (_, i) => ` Entity ${i} `),
    ];
    await capture();
    await worker().runOnce();
    const page = (await owner.query("SELECT entities FROM pages WHERE brain_id = $1", [brainId]))
      .rows[0];
    expect(page?.entities).toEqual([
      "acme",
      ...Array.from({ length: 19 }, (_, i) => `entity ${i}`),
    ]);
  });

  test.each([true, false])(
    "successful patches normalize and cap the entity union when changed=%j",
    async (changed) => {
      const existingEntities = [" Legacy ", "LEGACY", " "];
      const pageId = await seedCandidate("union", note, embeddingModel, existingEntities);
      factEntities = [" New ", "NEW", ...Array.from({ length: 25 }, (_, i) => ` Entity ${i} `)];
      patchResponse = JSON.stringify({
        title: "Original",
        summary: "Old summary",
        body: "Human body",
        changed,
        contradictions: [],
      });
      await capture();
      await worker().runOnce();
      const page = (
        await owner.query("SELECT entities, version FROM pages WHERE id = $1", [pageId])
      ).rows[0];
      expect(page?.entities).toEqual([
        "legacy",
        "new",
        ...Array.from({ length: 18 }, (_, i) => `entity ${i}`),
      ]);
      expect(page?.version).toBe(changed ? 2 : 1);
      expect(routing[0]).toMatchObject({ action: "place", reason: "score", entityOverlap: 0 });
    },
  );

  test("placing a fact patches and versions the page and refreshes its embedding", async () => {
    const pageId = await seedCandidate("target");
    patchResponse = JSON.stringify({
      title: "Updated",
      summary: note,
      body: "Updated body",
      changed: true,
      contradictions: [],
    });
    await capture();
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 1,
      versions: 2,
      sources: 1,
      events: 1,
      embeddings: 1,
      ledger: 4,
      reviews: 0,
    });
    const page = (
      await owner.query("SELECT title, body, version FROM pages WHERE id = $1", [pageId])
    ).rows[0];
    expect(page?.title).toBe("Updated");
    expect(page?.body).toContain("Updated body\n\n## Sources");
    expect(page?.version).toBe(2);
  });

  test("three facts for one page use one patch, version, event and complete evidence", async () => {
    const pageId = await seedCandidate("batch", note, "other-model", ["acme"]);
    factEntities = ["Acme", "Compiler"];
    patchResponse = JSON.stringify({
      title: "Batch",
      summary: "Three facts",
      body: "All three facts",
      changed: true,
      contradictions: [],
    });
    await capture(batchText);
    await worker().runOnce();
    expect(routing).toHaveLength(3);
    expect(routing.every((event) => event.chosenPageId === pageId)).toBe(true);
    const chats = provider.calls.filter((call) => call.kind === "chat");
    expect(chats).toHaveLength(2);
    const input = JSON.parse(chats[1]?.request.messages[1]?.content ?? "{}");
    expect(input.facts.map((fact: ExtractedFact) => fact.claim).sort()).toEqual(
      [...batchClaims].sort(),
    );
    expect(input.existing.version).toBe(1);
    expect(await counts()).toEqual({
      pages: 1,
      versions: 2,
      sources: 1,
      events: 1,
      embeddings: 2,
      ledger: 4,
      reviews: 0,
    });
    const chunks = await owner.query<{ id: string }>(
      "SELECT id FROM source_chunks WHERE source_id = $1 ORDER BY id",
      [sourceId],
    );
    expect(chunks.rows).toHaveLength(3);
    const links = await owner.query<{ chunk_uuids: string[] }>(
      "SELECT chunk_uuids FROM page_sources WHERE page_id = $1 AND ingest_source_id = $2",
      [pageId, sourceId],
    );
    expect(links.rows).toEqual([{ chunk_uuids: chunks.rows.map((chunk) => chunk.id) }]);
    const page = (
      await owner.query("SELECT body, version, entities FROM pages WHERE id = $1", [pageId])
    ).rows[0];
    expect(page?.version).toBe(2);
    expect(page?.entities).toEqual(["acme", "compiler"]);
    for (const chunk of chunks.rows) expect(page?.body).toContain(chunk.id);
    const event = (
      await owner.query(
        "SELECT change_summary, from_version, to_version FROM change_events WHERE page_id = $1",
        [pageId],
      )
    ).rows[0];
    expect(event).toEqual({
      change_summary: `${routing[0]?.factClaim} (3 facts)`,
      from_version: 1,
      to_version: 2,
    });
    expect(provider.calls.filter((call) => call.kind === "embed")).toHaveLength(2);
    const calls = provider.calls.length;
    await owner.query("UPDATE jobs SET status = 'pending' WHERE id = $1", [jobId]);
    await worker().runOnce();
    expect(provider.calls).toHaveLength(calls);
    expect((await counts())?.versions).toBe(2);
    expect((await counts())?.events).toBe(1);
  });

  test("facts routed to two pages use exactly two patches after all routing", async () => {
    const alpha = await seedCandidate("alpha", note, "other-model", ["alpha"]);
    const beta = await seedCandidate("beta", note, "other-model", ["beta"]);
    entitiesByClaim = Object.fromEntries(
      batchClaims.map((claim, index) => [claim, [index === 1 ? "beta" : "alpha"]]),
    );
    patchResponse = JSON.stringify({
      title: "Batch",
      summary: "Batch update",
      body: "Batch body",
      changed: true,
      contradictions: [],
    });
    const base = compiler();
    const instance = createWorker({
      withTenant,
      tenantIds: [tenantId],
      store,
      compiler: {
        ...base,
        chatProvider: {
          chat: async (request) => {
            const input = JSON.parse(request.messages[1]?.content ?? "{}");
            if (input.facts) expect(routing).toHaveLength(3);
            return base.chatProvider.chat(request);
          },
        },
      },
      handlers: {
        "capture.compile": (context) =>
          compileCapture({ ...context, onRouting: (event) => routing.push(event) }),
      },
    });
    await capture(batchText);
    await instance.runOnce();
    const chats = provider.calls.filter((call) => call.kind === "chat");
    expect(chats).toHaveLength(3);
    const patches = chats
      .slice(1)
      .map((call) => JSON.parse(call.request.messages[1]?.content ?? "{}"));
    expect(patches.map((input) => input.existing.id)).toEqual([alpha, beta].sort());
    expect(patches.map((input) => input.facts.length).sort()).toEqual([1, 2]);
    expect((await counts())?.versions).toBe(4);
    expect((await counts())?.events).toBe(2);
    expect((await counts())?.sources).toBe(2);
    expect(provider.calls.filter((call) => call.kind === "embed")).toHaveLength(3);
  });

  test("a batch records all contradictions in one contest event", async () => {
    const pageId = await seedCandidate("batch-contested", note, "other-model", ["acme"]);
    factEntities = ["Acme"];
    const base = compiler();
    let contradictions: {
      existingClaim: string;
      newClaim: string;
      evidence: ExtractedFact["evidence"];
    }[] = [];
    const instance = createWorker({
      withTenant,
      tenantIds: [tenantId],
      store,
      compiler: {
        ...base,
        chatProvider: {
          chat: async (request) => {
            const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
              facts?: ExtractedFact[];
            };
            if (input.facts) {
              contradictions = input.facts.slice(1).map((fact) => ({
                existingClaim: "Old claim",
                newClaim: fact.claim,
                evidence: fact.evidence,
              }));
              patchResponse = JSON.stringify({
                title: "Ignored",
                summary: "Ignored",
                body: "Ignored",
                changed: false,
                contradictions,
              });
            }
            return base.chatProvider.chat(request);
          },
        },
      },
    });
    await capture(batchText);
    await instance.runOnce();
    expect(contradictions).toHaveLength(2);
    expect((await counts())?.versions).toBe(2);
    expect((await counts())?.events).toBe(1);
    expect((await counts())?.sources).toBe(1);
    expect(provider.calls.filter((call) => call.kind === "chat")).toHaveLength(2);
    const page = (
      await owner.query("SELECT status, body, version FROM pages WHERE id = $1", [pageId])
    ).rows[0];
    expect(page).toEqual({ status: "contested", body: "Human body", version: 2 });
    const event = (
      await owner.query("SELECT contradictions FROM change_events WHERE page_id = $1", [pageId])
    ).rows[0];
    expect(event?.contradictions).toEqual(contradictions);
    const link = (
      await owner.query("SELECT chunk_uuids FROM page_sources WHERE page_id = $1", [pageId])
    ).rows[0];
    expect(link?.chunk_uuids).toHaveLength(3);
  });

  test("an unchanged batch attaches every chunk without a version, event or page embedding", async () => {
    const pageId = await seedCandidate("batch-unchanged", note, "other-model", ["acme"]);
    factEntities = ["Acme"];
    await owner.query(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       SELECT tenant_id, page_id, $2, dimensions, embedding, content_hash FROM page_embeddings
       WHERE page_id = $1`,
      [pageId, embeddingModel],
    );
    patchResponse = JSON.stringify({
      title: "Original",
      summary: "Old summary",
      body: "Human body",
      changed: false,
      contradictions: [],
    });
    await capture(batchText);
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 1,
      versions: 1,
      sources: 1,
      events: 0,
      embeddings: 2,
      ledger: 3,
      reviews: 0,
    });
    expect(provider.calls.filter((call) => call.kind === "chat")).toHaveLength(2);
    expect(provider.calls.filter((call) => call.kind === "embed")).toHaveLength(1);
    const link = (
      await owner.query("SELECT chunk_uuids FROM page_sources WHERE page_id = $1", [pageId])
    ).rows[0];
    expect(link?.chunk_uuids).toHaveLength(3);
  });

  test("three review facts create three reviews and no page, patch or version", async () => {
    const candidates = [
      await seedCandidate("batch-review-a", note, embeddingModel, ["acme"]),
      await seedCandidate("batch-review-b", note, embeddingModel, ["acme"]),
    ];
    factEntities = ["Acme"];
    const base = compiler();
    const instance = createWorker({
      withTenant,
      tenantIds: [tenantId],
      store,
      compiler: {
        ...base,
        embeddingProvider: {
          embed: async (texts) => {
            const result = await base.embeddingProvider.embed(texts);
            const vector = (await createFakeProvider().embed([note])).vectors[0];
            if (!vector) throw new Error("Missing fixture vector");
            return { ...result, vectors: texts.map(() => vector) };
          },
        },
      },
    });
    await capture(batchText);
    await instance.runOnce();
    expect(await counts()).toEqual({
      pages: 2,
      versions: 2,
      sources: 0,
      events: 0,
      embeddings: 2,
      ledger: 2,
      reviews: 3,
    });
    expect(provider.calls.filter((call) => call.kind === "chat")).toHaveLength(1);
    const reviews = await owner.query<{ candidate_page_ids: string[]; fact: ExtractedFact }>(
      "SELECT candidate_page_ids, fact FROM routing_reviews WHERE brain_id = $1",
      [brainId],
    );
    expect(reviews.rows.map((row) => row.fact.claim).sort()).toEqual([...batchClaims].sort());
    for (const review of reviews.rows) expect(review.candidate_page_ids).toEqual(candidates);
  });

  test("new pages remain visible to later facts before a single grouped patch", async () => {
    factEntities = ["Acme"];
    patchResponse = JSON.stringify({
      title: "Acme",
      summary: "Three facts",
      body: "Consolidated facts",
      changed: true,
      contradictions: [],
    });
    await capture(batchText);
    await worker().runOnce();
    expect(routing.map((event) => event.action)).toEqual(["new", "place", "place"]);
    expect(routing.slice(1).every((event) => event.reason === "entity")).toBe(true);
    const chats = provider.calls.filter((call) => call.kind === "chat");
    expect(chats).toHaveLength(2);
    const input = JSON.parse(chats[1]?.request.messages[1]?.content ?? "{}");
    expect(input.facts).toHaveLength(2);
    expect((await counts())?.pages).toBe(1);
    expect((await counts())?.versions).toBe(2);
    expect((await counts())?.events).toBe(2);
    expect((await counts())?.sources).toBe(1);
    const links = await owner.query<{ chunk_uuids: string[] }>(
      "SELECT chunk_uuids FROM page_sources WHERE ingest_source_id = $1",
      [sourceId],
    );
    expect(links.rows[0]?.chunk_uuids).toHaveLength(3);
  });

  test("manual edits keep their body and append updates on subsequent compiles", async () => {
    const pageId = await seedCandidate("edited");
    await owner.query(
      "UPDATE pages SET user_edited_at = '2026-11-07T00:00:00Z', last_compiled_at = '2026-11-06T00:00:00Z' WHERE id = $1",
      [pageId],
    );
    patchResponse = JSON.stringify({
      title: "Rewritten",
      summary: "Rewritten",
      body: "Update",
      changed: true,
      contradictions: [],
    });
    await capture();
    await worker().runOnce();
    const page = (
      await owner.query(
        "SELECT title, body, user_edited_at > last_compiled_at AS protected FROM pages WHERE id = $1",
        [pageId],
      )
    ).rows[0];
    expect(page?.title).toBe("Original");
    expect(page?.body).toStartWith("Human body\n\n## Updates");
    expect(page?.protected).toBe(true);
  });

  test("unchanged patches attach evidence without a version or embedding call", async () => {
    await seedCandidate("unchanged");
    patchResponse = JSON.stringify({
      title: "Original",
      summary: "Old summary",
      body: "Human body",
      changed: false,
      contradictions: [],
    });
    await capture();
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 1,
      versions: 1,
      sources: 1,
      events: 0,
      embeddings: 1,
      ledger: 3,
      reviews: 0,
    });
  });

  test("contradictions contest the page and retain both claims in the event", async () => {
    const pageId = await seedCandidate("contested");
    const base = compiler();
    const instance = createWorker({
      withTenant,
      tenantIds: [tenantId],
      store,
      compiler: {
        ...base,
        chatProvider: {
          chat: async (request) => {
            const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
              facts?: ExtractedFact[];
            };
            const evidence = input.facts?.[0]?.evidence;
            if (evidence)
              patchResponse = JSON.stringify({
                title: "Ignored",
                summary: "",
                body: "Ignored",
                changed: true,
                contradictions: [{ existingClaim: "Old claim", newClaim: note, evidence }],
              });
            return base.chatProvider.chat(request);
          },
        },
      },
    });
    await capture();
    await instance.runOnce();
    const page = (
      await owner.query("SELECT status, body, version FROM pages WHERE id = $1", [pageId])
    ).rows[0];
    expect(page?.status).toBe("contested");
    expect(page?.body).toBe("Human body");
    expect(page?.version).toBe(2);
    const event = (
      await owner.query("SELECT contradictions FROM change_events WHERE page_id = $1", [pageId])
    ).rows[0];
    expect(event?.contradictions[0]?.existingClaim).toBe("Old claim");
    expect(event?.contradictions[0]?.newClaim).toBe(note);
    expect((await counts())?.ledger).toBe(3);
  });

  test.each([true, false])("provider failure is classified as transient=%j", async (transient) => {
    failChat = new ProviderError(
      transient ? "server_error" : "bad_request",
      transient,
      "private detail",
    );
    await capture();
    await worker().runOnce();
    const row = (await owner.query("SELECT status, last_error FROM jobs WHERE id = $1", [jobId]))
      .rows[0];
    expect(row?.status).toBe(transient ? "pending" : "dead");
    expect(row?.last_error).toBe("Compiler provider failed");
    expect(
      (await owner.query("SELECT status FROM ingest_sources WHERE id = $1", [sourceId])).rows[0]
        ?.status,
    ).toBe("failed");
  });

  test("malformed patch output is permanent and preserves incurred usage after rollback", async () => {
    await seedCandidate("invalid");
    patchResponse = "invalid JSON";
    await capture();
    await worker().runOnce();
    expect((await counts())?.ledger).toBe(3);
    expect((await counts())?.versions).toBe(1);
    expect(
      (await owner.query("SELECT status FROM jobs WHERE id = $1", [jobId])).rows[0]?.status,
    ).toBe("dead");
  });

  test("embedding failures roll back page writes, preserve cost, and retry without duplicates", async () => {
    failPageEmbedding = true;
    await capture();
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 0,
      versions: 0,
      sources: 0,
      events: 0,
      embeddings: 0,
      ledger: 2,
      reviews: 0,
    });
    failPageEmbedding = false;
    await owner.query("UPDATE jobs SET available_at = now() WHERE id = $1", [jobId]);
    await worker().runOnce();
    expect(await counts()).toEqual({
      pages: 1,
      versions: 1,
      sources: 1,
      events: 1,
      embeddings: 1,
      ledger: 5,
      reviews: 0,
    });
    const extractions = provider.calls.filter((call) => call.kind === "chat");
    expect(extractions).toHaveLength(2);
    expect(extractions[0]?.request.messages).toEqual(extractions[1]?.request.messages);
  });

  test("slug collisions get a deterministic suffix and candidates never mix models", async () => {
    const existing = await seedCandidate("the-compiler-preserves-evidence", note, "other-model");
    await capture();
    await worker().runOnce();
    expect((await counts())?.pages).toBe(2);
    const pages = await owner.query<{ slug: string }>(
      "SELECT slug FROM pages WHERE brain_id = $1 AND id <> $2",
      [brainId, existing],
    );
    expect(pages.rows[0]?.slug).toBe(
      `the-compiler-preserves-evidence-${contentHash(`${sourceId}\n0\n${note}`).slice(0, 12)}`,
    );
  });

  test("the candidate query uses a bounded exact vector scan", async () => {
    await seedCandidate("plan");
    const vector = (await provider.embed([note])).vectors[0];
    await withTenant(tenantId, async (client) => {
      expect(
        (await client.query("SELECT id FROM pages WHERE tenant_id = $1", [foreignTenantId])).rows,
      ).toEqual([]);
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${CANDIDATES_SQL}`, [
        JSON.stringify(vector),
        tenantId,
        brainId,
        embeddingModel,
      ]);
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("Limit");
    });
  });

  test("entity lookup is scoped, filters inactive pages and orders overlaps deterministically", async () => {
    const entities = ["acme", "beta"];
    const less = await seedCandidate("a-less", note, embeddingModel, ["acme"]);
    const last = await seedCandidate("z-tied", note, embeddingModel, entities);
    const first = await seedCandidate("b-tied", note, embeddingModel, entities);
    const foreign = newId("page");
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash, entities)
       VALUES ($1, $2, $3, $4, 'foreign', 'Foreign', 'foreign', $5)`,
      [foreign, foreignTenantId, subjectId, foreignBrainId, entities],
    );
    const otherBrain = newId("brain");
    await owner.query(
      "INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, 'Other', $1)",
      [otherBrain, tenantId, subjectId],
    );
    const hidden = [
      await seedCandidate("archived", note, embeddingModel, entities),
      await seedCandidate("deleted", note, embeddingModel, entities),
      await seedCandidate("other-brain", note, embeddingModel, entities),
    ];
    await owner.query("UPDATE pages SET status = 'archived' WHERE id = $1", [hidden[0]]);
    await owner.query("UPDATE pages SET deletion_state = 'deleted' WHERE id = $1", [hidden[1]]);
    await owner.query("UPDATE pages SET brain_id = $2 WHERE id = $1", [hidden[2], otherBrain]);
    await owner.query("UPDATE pages SET status = 'contested' WHERE id = $1", [last]);
    await withTenant(tenantId, async (client) => {
      expect(
        (await client.query(ENTITY_PAGES_SQL, [entities, foreignTenantId, foreignBrainId, null]))
          .rows,
      ).toEqual([]);
      expect(
        (await client.query(ENTITY_PAGES_SQL, [entities, tenantId, foreignBrainId, null])).rows,
      ).toEqual([]);
      expect(
        (await client.query(ENTITY_PAGES_SQL, [entities, tenantId, brainId, null])).rows,
      ).toEqual([
        { id: first, overlap: 2 },
        { id: last, overlap: 2 },
      ]);
      expect(
        (await client.query(ENTITY_PAGES_SQL, [entities, tenantId, brainId, [less, ...hidden]]))
          .rows,
      ).toEqual([{ id: less, overlap: 1 }]);
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${ENTITY_PAGES_SQL}`, [
        entities,
        tenantId,
        brainId,
        null,
      ]);
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("Limit");
    });
  });
});
