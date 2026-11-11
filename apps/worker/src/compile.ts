import { chunkBody } from "@memtavi/core/compile/chunk";
import { CompileError, extractFacts } from "@memtavi/core/compile/extract";
import { applyPatch, buildPatchMessages, parsePatchResult } from "@memtavi/core/compile/patch";
import { decideMws } from "@memtavi/core/compile/policies/mws";
import { decidePfs } from "@memtavi/core/compile/policies/pfs";
import { promptVersion } from "@memtavi/core/compile/prompts";
import {
  type ExtractedFact,
  extractedFactSchema,
  type PatchResult,
} from "@memtavi/core/compile/schemas";
import { enqueueScoreSnapshot } from "@memtavi/db/health";
import { chatCostUsd, embeddingCostUsd } from "@memtavi/llm/cost";
import { type ChatResult, type EmbeddingResult, ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { chunkKey, contentHash } from "@memtavi/storage/keys";
import { StorageError } from "@memtavi/storage/types";
import { assertBudget } from "./budget";
import { type JobContext, JobError, type RoutingEvent } from "./types";

export const PAGE_BODY_MAX_CHARS = 6000;

interface SourceRow {
  content: string;
  body_ref: string | null;
  subject_id: string;
  status: string;
  deleted_at: Date | null;
  awaiting_approval: boolean;
  body_dropped_at: Date | null;
}

interface PageRow {
  id: string;
  title: string;
  summary: string;
  body: string;
  version: number;
  content_hash: string;
  user_edited_at: Date | null;
  last_compiled_at: Date | null;
  entities: string[];
}

export const CANDIDATES_SQL = `
  SELECT p.id, p.slug, p.entities,
    COALESCE((SELECT v.created_at FROM page_versions v
      WHERE v.tenant_id = p.tenant_id AND v.page_id = p.id AND v.version = 1), 'epoch'::timestamptz) AS "createdAt",
    greatest(0, least(1, 1 - (e.embedding <=> $1::vector))) AS score
  FROM pages p JOIN page_embeddings e ON e.tenant_id = p.tenant_id AND e.page_id = p.id
  WHERE p.tenant_id = $2 AND p.brain_id = $3 AND e.model = $4 AND e.dimensions = 1536
    AND p.status IN ('active', 'contested') AND p.deletion_state = 'active'
  ORDER BY e.embedding <=> $1::vector, "createdAt", p.slug, p.id
  LIMIT 5
`;

export const WEBHOOK_ENQUEUE_SQL = `
  INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
  SELECT $1, $2, 'webhook.deliver',
    jsonb_build_object('webhookId', w.id, 'eventId', $3::text),
    'webhook:' || $3::text || ':' || w.id::text,
    5
  FROM webhooks w
  WHERE w.tenant_id = $1 AND w.subject_id = $4 AND w.active = true
    AND $5::text = ANY(w.events)
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
`;

export const ENTITY_PAGES_SQL = `
  SELECT p.id,
    cardinality(ARRAY(SELECT unnest(p.entities) INTERSECT SELECT unnest($1::text[]))) AS overlap
  FROM pages p
  WHERE p.tenant_id = $2 AND p.brain_id = $3
    AND p.status IN ('active', 'contested') AND p.deletion_state = 'active'
    AND p.entities && $1::text[]
    AND ($4::text[] IS NULL OR p.id = ANY($4::text[]))
  ORDER BY overlap DESC, p.slug, p.id
  LIMIT 2
`;

function normalizeEntities(entities: readonly string[]): string[] {
  return [...new Set(entities.map((entity) => entity.trim().toLowerCase()).filter(Boolean))].slice(
    0,
    20,
  );
}

export async function compileCapture(context: JobContext): Promise<void> {
  try {
    await compileSource(context);
  } catch (error) {
    if (error instanceof ProviderError || error instanceof StorageError) {
      throw new JobError(error.transient ? "transient" : "permanent", "Compiler provider failed");
    }
    if (error instanceof CompileError || (error instanceof Error && error.name === "ZodError")) {
      throw new JobError("permanent", "Invalid compiler output");
    }
    throw error;
  }
}

async function compileSource({
  job,
  client,
  store,
  compiler,
  recordUsage,
  onRouting,
}: JobContext): Promise<void> {
  const isReview = job.type === "review.apply";
  const sourceId = job.payload.sourceId;
  if (typeof sourceId !== "string" || !sourceId || job.payload.brainId !== job.brainId) {
    throw new JobError("permanent", "Invalid job payload");
  }
  const scope = [job.tenantId, job.brainId, sourceId];
  const brain = await client.query(
    `SELECT id FROM brains WHERE tenant_id = $1 AND id = $2
     AND deletion_state = 'active' FOR NO KEY UPDATE`,
    scope.slice(0, 2),
  );
  if (!brain.rowCount) return;
  const sources = await client.query<SourceRow>(
    `SELECT content, body_ref, subject_id, status, deleted_at, awaiting_approval, body_dropped_at FROM ingest_sources
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 FOR UPDATE`,
    scope,
  );
  const source = sources.rows[0];
  if (
    !source ||
    source.deleted_at ||
    source.body_dropped_at ||
    source.awaiting_approval ||
    (!isReview && source.status === "completed")
  )
    return;
  await assertBudget(client, job.tenantId);
  let reviewFact: ExtractedFact | undefined;
  if (isReview) {
    const applied = await client.query<{ applied: boolean }>(
      `SELECT COALESCE((payload->>'applied')::boolean, false) AS applied FROM jobs
       WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 FOR NO KEY UPDATE`,
      [job.tenantId, job.brainId, job.id],
    );
    if (!applied.rowCount) throw new JobError("permanent", "Missing review job");
    if (applied.rows[0]?.applied) return;
    if (
      typeof job.payload.reviewId !== "string" ||
      !((typeof job.payload.pageId === "string") !== (job.payload.newPage === true))
    ) {
      throw new JobError("permanent", "Invalid review payload");
    }
    const review = await client.query<{ fact: unknown; candidate_page_ids: string[] }>(
      `SELECT fact, candidate_page_ids FROM routing_reviews
       WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
         AND ingest_source_id = $4 AND status = 'resolved' FOR UPDATE`,
      [job.tenantId, job.brainId, job.payload.reviewId, sourceId],
    );
    const row = review.rows[0];
    if (
      !row ||
      (typeof job.payload.pageId === "string" &&
        !row.candidate_page_ids.includes(job.payload.pageId))
    ) {
      throw new JobError("permanent", "Invalid resolved review");
    }
    reviewFact = extractedFactSchema.parse(row.fact);
  }
  if (!compiler) throw new JobError("permanent", "Compiler configuration is required");
  const { chatProvider, embeddingProvider, chatModel, embeddingModel } = compiler;
  const subjectId = source.subject_id;
  const chunks: { chunkUuid: string; text: string }[] = [];
  if (isReview) {
    const stored = await client.query<{ id: string; text: string | null; body_ref: string | null }>(
      `SELECT id, text, body_ref FROM source_chunks
       WHERE tenant_id = $1 AND brain_id = $2 AND source_id = $3 AND id = $4 LIMIT 1`,
      [...scope, reviewFact?.evidence.chunkUuid],
    );
    for (const chunk of stored.rows) {
      chunks.push({
        chunkUuid: chunk.id,
        text: chunk.body_ref
          ? await new Response(await store.get(chunk.body_ref)).text()
          : (chunk.text ?? ""),
      });
    }
    const evidence = reviewFact?.evidence;
    const text = chunks.find((chunk) => chunk.chunkUuid === evidence?.chunkUuid)?.text;
    if (
      !evidence ||
      text === undefined ||
      evidence.charEnd <= evidence.charStart ||
      evidence.charEnd > text.length ||
      text.slice(evidence.charStart, evidence.charEnd) !== evidence.quote
    ) {
      throw new CompileError();
    }
  } else {
    const body = source.body_ref
      ? await new Response(await store.get(source.body_ref)).text()
      : source.content;
    for (const [ordinal, chunk] of chunkBody(body).entries()) {
      const bodyRef = chunkKey({ tenantId: job.tenantId, sourceId, body: chunk.text, ordinal });
      await store.put(bodyRef, chunk.text, "text/plain; charset=utf-8");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO source_chunks
       (id, tenant_id, brain_id, source_id, ordinal, text, body_ref, char_start, char_end, token_count)
       VALUES ($9::uuid, $1, $2, $3, $4, NULL, $5, $6, $7, $8) RETURNING id`,
        [
          ...scope,
          ordinal,
          bodyRef,
          chunk.charStart,
          chunk.charEnd,
          Math.ceil(chunk.text.length / 4),
          contentHash(bodyRef).slice(0, 32),
        ],
      );
      const chunkUuid = inserted.rows[0]?.id;
      if (!chunkUuid) throw new JobError("permanent", "Chunk write failed");
      chunks.push({ chunkUuid, text: chunk.text });
    }
    await client.query(
      `UPDATE ingest_sources SET status = 'compiling', chunk_uuids = $4, last_error = NULL
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
      [...scope, chunks.map((chunk) => chunk.chunkUuid)],
    );
  }

  async function ledger(result: ChatResult | EmbeddingResult): Promise<void> {
    const chat = "text" in result;
    const input = result.usage.inputTokens;
    const output = "outputTokens" in result.usage ? result.usage.outputTokens : 0;
    const costUsd = chat
      ? chatCostUsd(input, output, compiler?.chatPrices)
      : embeddingCostUsd(input, compiler?.embeddingPrices);
    if (recordUsage) {
      await recordUsage({
        provider: chat ? "openrouter" : "openai",
        model: result.model,
        kind: chat ? "chat" : "embedding",
        inputTokens: input,
        outputTokens: output,
        costUsd,
      });
      return;
    }
    await client.query(
      `INSERT INTO usage_ledger
       (tenant_id, brain_id, job_id, provider, model, kind, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        job.tenantId,
        job.brainId,
        job.id,
        chat ? "openrouter" : "openai",
        result.model,
        chat ? "chat" : "embedding",
        input,
        output,
        costUsd,
      ],
    );
  }

  async function embed(texts: readonly string[]): Promise<EmbeddingResult> {
    await assertBudget(client, job.tenantId);
    const result = await embeddingProvider.embed(texts);
    await ledger(result);
    if (
      result.model !== embeddingModel ||
      result.dimensions !== 1536 ||
      result.vectors.length !== texts.length ||
      result.vectors.some(
        (vector) =>
          vector.length !== 1536 ||
          vector.some((value) => !Number.isFinite(value)) ||
          vector.every((value) => value === 0),
      )
    )
      throw new JobError("permanent", "Invalid compiler embedding");
    return result;
  }

  const facts: ExtractedFact[] = [];
  if (reviewFact) facts.push(reviewFact);
  for (let start = 0; !isReview && start < chunks.length; start += 8) {
    await assertBudget(client, job.tenantId);
    const extraction = await extractFacts(
      {
        chat: async (request) => {
          const response = await chatProvider.chat(request);
          await ledger(response);
          return response;
        },
      },
      chunks.slice(start, start + 8),
      {
        model: chatModel,
        promptVersion: promptVersion("extract"),
        ...(compiler.chatPrices ? { prices: compiler.chatPrices } : {}),
      },
    );
    facts.push(...extraction.facts.filter((fact) => decideMws(fact).band !== "source_only"));
  }
  const vectors =
    !isReview && facts.length ? (await embed(facts.map((fact) => fact.claim))).vectors : [];
  const affected = new Set<string>();

  async function recordPage(
    page: PageRow,
    pageFacts: readonly ExtractedFact[],
    previousVersion: number | null,
    contradictions: PatchResult["contradictions"],
    changed: boolean,
    splitFrom?: PageRow,
  ): Promise<void> {
    affected.add(page.id);
    if (changed) {
      await client.query(
        `INSERT INTO page_versions
         (tenant_id, page_id, version, title, summary, body, ingest_source_id, actor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'compiler')`,
        [job.tenantId, page.id, page.version, page.title, page.summary, page.body, sourceId],
      );
      const eventId = newId("change");
      const action = isReview
        ? "routed"
        : splitFrom
          ? "split"
          : previousVersion === null
            ? "created"
            : "updated";
      const changeSummary = splitFrom
        ? `Split from ${splitFrom.title} (${splitFrom.id})`
        : previousVersion === null
          ? pageFacts[0]?.claim
          : `${pageFacts[0]?.claim} (${pageFacts.length} facts)`;
      await client.query(
        `INSERT INTO change_events
         (id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version, ingest_source_id, contradictions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          eventId,
          job.tenantId,
          job.brainId,
          page.id,
          action,
          changeSummary,
          previousVersion,
          page.version,
          sourceId,
          JSON.stringify(contradictions),
        ],
      );
      await client.query(WEBHOOK_ENQUEUE_SQL, [
        job.tenantId,
        job.brainId,
        eventId,
        subjectId,
        action,
      ]);
    }
    await client.query(
      `INSERT INTO page_sources (tenant_id, page_id, ingest_source_id, chunk_uuids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (page_id, ingest_source_id) DO UPDATE SET chunk_uuids = ARRAY(
         SELECT DISTINCT chunk FROM unnest(page_sources.chunk_uuids || EXCLUDED.chunk_uuids) AS chunk ORDER BY chunk)
       WHERE page_sources.tenant_id = $1`,
      [
        job.tenantId,
        page.id,
        sourceId,
        [...new Set(pageFacts.map((fact) => fact.evidence.chunkUuid))].sort(),
      ],
    );
    const embedded = await client.query(
      `SELECT page_id FROM page_embeddings
       WHERE tenant_id = $1 AND page_id = $2 AND model = $3 AND content_hash = $4 LIMIT 1`,
      [job.tenantId, page.id, embeddingModel, page.content_hash],
    );
    if (embedded.rowCount === 0) {
      const result = await embed([`${page.title}\n${page.summary}\n${page.body}`]);
      await client.query(
        `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
         VALUES ($1, $2, $3, $4, $5::vector, $6)
         ON CONFLICT (page_id, model) DO UPDATE SET embedding = EXCLUDED.embedding,
         dimensions = EXCLUDED.dimensions, content_hash = EXCLUDED.content_hash
         WHERE page_embeddings.tenant_id = $1`,
        [
          job.tenantId,
          page.id,
          embeddingModel,
          result.dimensions,
          JSON.stringify(result.vectors[0]),
          page.content_hash,
        ],
      );
      await client.query("UPDATE pages SET embedding_model = $3 WHERE tenant_id = $1 AND id = $2", [
        job.tenantId,
        page.id,
        embeddingModel,
      ]);
    }
  }
  async function createPage(
    pageFacts: readonly ExtractedFact[],
    title: string,
    pageType: "entity" | "topic",
    entities: string[],
    suffixKey: string | number,
    splitFrom?: PageRow,
  ): Promise<PageRow> {
    const first = pageFacts[0];
    if (!first) throw new JobError("permanent", "Missing page facts");
    const sources = [
      ...new Set(
        pageFacts.map(
          ({ evidence }) =>
            `- ${evidence.chunkUuid}:${evidence.charStart}-${evidence.charEnd} ${JSON.stringify(evidence.quote)}`,
        ),
      ),
    ]
      .sort()
      .join("\n");
    const pageBody = `${pageFacts.map((fact) => fact.claim).join("\n\n")}\n\n## Sources\n${sources}`;
    const page: PageRow = {
      id: newId("page"),
      title,
      summary: first.claim,
      body: pageBody,
      version: 1,
      content_hash: contentHash(`${title}\n${first.claim}\n${pageBody}`),
      user_edited_at: null,
      last_compiled_at: null,
      entities,
    };
    const baseSlug =
      title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "topic";
    const suffix = contentHash(`${sourceId}\n${suffixKey}\n${first.claim}`).slice(0, 12);
    let attempt = 0;
    while (true) {
      const slug =
        attempt === 0 ? baseSlug : `${baseSlug}-${suffix}${attempt > 1 ? `-${attempt}` : ""}`;
      const inserted = await client.query(
        `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, content_hash, last_compiled_at, entities)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $10, $9, now(), $11)
         ON CONFLICT (brain_id, slug) WHERE deletion_state = 'active' DO NOTHING`,
        [
          page.id,
          job.tenantId,
          subjectId,
          job.brainId,
          slug,
          title,
          first.claim,
          page.body,
          page.content_hash,
          pageType,
          entities,
        ],
      );
      if (inserted.rowCount) break;
      attempt += 1;
    }
    await recordPage(page, pageFacts, null, [], true, splitFrom);
    return page;
  }
  const routing: RoutingEvent[] = [];
  const placed = new Map<string, ExtractedFact[]>();
  for (const [index, fact] of facts.entries()) {
    if (isReview) {
      if (typeof job.payload.pageId === "string") {
        placed.set(job.payload.pageId, [fact]);
      } else {
        const title =
          fact.entities.find((entity) => entity.trim())?.trim() ?? fact.claim.trim().slice(0, 120);
        const entities = normalizeEntities(fact.entities);
        await createPage(
          [fact],
          title,
          entities.length > 0 ? "entity" : "topic",
          entities,
          job.payload.reviewId as string,
        );
      }
      continue;
    }
    const entities = normalizeEntities(fact.entities);
    const vector = vectors[index];
    if (!vector) throw new JobError("permanent", "Missing fact embedding");
    const candidates = await client.query<{
      id: string;
      slug: string;
      createdAt: Date;
      score: number;
      entities: string[];
    }>(CANDIDATES_SQL, [JSON.stringify(vector), job.tenantId, job.brainId, embeddingModel]);
    let decision = decidePfs(
      candidates.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    );
    let reason: RoutingEvent["reason"] = decision.action === "new" ? "new" : "score";
    let entityOverlap = 0;
    if (decision.action !== "place" && entities.length > 0) {
      const matches = await client.query<{ id: string; overlap: number }>(ENTITY_PAGES_SQL, [
        entities,
        job.tenantId,
        job.brainId,
        decision.action === "review" ? candidates.rows.map((row) => row.id) : null,
      ]);
      const first = matches.rows[0];
      const second = matches.rows[1];
      entityOverlap = first?.overlap ?? 0;
      if (
        first &&
        (decision.action === "review" ? !second : first.overlap > (second?.overlap ?? 0))
      ) {
        decision = { ...decision, action: "place", pageId: first.id };
        reason = "entity";
      }
    } else if (decision.action === "place") {
      const pageId = decision.pageId;
      const chosen = candidates.rows.find((row) => row.id === pageId);
      entityOverlap = normalizeEntities(chosen?.entities ?? []).filter((entity) =>
        entities.includes(entity),
      ).length;
    }
    routing.push({
      sourceId,
      factClaim: fact.claim,
      action: decision.action,
      reason,
      entityOverlap,
      best: decision.best,
      second: decision.second,
      gap: decision.gap,
      candidateCount: candidates.rows.length,
      candidateIds: candidates.rows.map((row) => row.id),
      ...(decision.action === "place" ? { chosenPageId: decision.pageId } : {}),
    });
    if (decision.action === "review") {
      await client.query(
        `INSERT INTO routing_reviews
         (tenant_id, brain_id, ingest_source_id, fact, candidate_page_ids, best_gap)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [...scope, JSON.stringify(fact), decision.candidateIds, decision.gap],
      );
      continue;
    }
    if (decision.action === "place") {
      const pageFacts = placed.get(decision.pageId) ?? [];
      pageFacts.push(fact);
      placed.set(decision.pageId, pageFacts);
      continue;
    }
    const title =
      fact.entities.find((entity) => entity.trim())?.trim() ?? fact.claim.trim().slice(0, 120);
    await createPage([fact], title, entities.length > 0 ? "entity" : "topic", entities, index);
  }
  for (const [pageId, pageFacts] of [...placed].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const found = await client.query<PageRow>(
      `SELECT id, title, summary, body, version, content_hash, user_edited_at, last_compiled_at, entities
       FROM pages WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
       AND deletion_state = 'active' AND status IN ('active', 'contested') FOR UPDATE`,
      [job.tenantId, job.brainId, pageId],
    );
    const existing = found.rows[0];
    if (!existing) throw new JobError(isReview ? "permanent" : "transient", "Routing page changed");
    const userEdited = existing.user_edited_at !== null;
    const estimatedSize =
      existing.body.length + pageFacts.reduce((total, fact) => total + fact.claim.length + 200, 0);
    if (!isReview && !userEdited && estimatedSize > PAGE_BODY_MAX_CHARS) {
      const frequencies = new Map<string, number>();
      for (const fact of pageFacts) {
        const entities = new Set(
          fact.entities.map((entity) => entity.trim().toLowerCase()).filter(Boolean),
        );
        for (const entity of entities) {
          if (entity !== existing.title.trim().toLowerCase()) {
            frequencies.set(entity, (frequencies.get(entity) ?? 0) + 1);
          }
        }
      }
      const secondary = [...frequencies].sort(
        ([left, a], [right, b]) => b - a || (left < right ? -1 : left > right ? 1 : 0),
      )[0]?.[0];
      const title = secondary ?? `${existing.title} — ${pageFacts[0]?.claim.slice(0, 60)}`;
      const sibling = await createPage(
        pageFacts,
        title,
        secondary ? "entity" : "topic",
        normalizeEntities(pageFacts.flatMap((fact) => fact.entities)),
        pageId,
        existing,
      );
      for (const event of routing) {
        if (event.action === "place" && event.chosenPageId === pageId) {
          event.reason = "split";
          event.chosenPageId = sibling.id;
        }
      }
      continue;
    }
    await assertBudget(client, job.tenantId);
    const response = await chatProvider.chat({
      model: chatModel,
      temperature: 0,
      responseFormat: "json",
      messages: buildPatchMessages(existing, pageFacts, {
        userEdited,
        promptVersion: promptVersion("patch"),
      }),
    });
    await ledger(response);
    const parsed = parsePatchResult(response.text);
    for (const { evidence } of parsed.contradictions) {
      const text = chunks.find((chunk) => chunk.chunkUuid === evidence.chunkUuid)?.text;
      if (
        text === undefined ||
        evidence.charEnd <= evidence.charStart ||
        evidence.charEnd > text.length ||
        text.slice(evidence.charStart, evidence.charEnd) !== evidence.quote
      ) {
        throw new CompileError();
      }
    }
    const patch = applyPatch(existing, parsed, {
      userEdited,
      facts: pageFacts,
    });
    const contradictions = patch.contradictions;
    const changed = patch.changed || contradictions.length > 0;
    const previousVersion = existing.version;
    const page = {
      ...existing,
      title: patch.title,
      summary: patch.summary,
      body: patch.body,
      version: existing.version + (changed ? 1 : 0),
      entities: normalizeEntities([
        ...existing.entities,
        ...pageFacts.flatMap((fact) => normalizeEntities(fact.entities)),
      ]),
    };
    page.content_hash = contentHash(`${page.title}\n${page.summary}\n${page.body}`);
    if (changed) {
      await client.query(
        `UPDATE pages SET title = $4, summary = $5, body = $6, version = $7, content_hash = $8,
         status = CASE WHEN $9 THEN 'contested'::page_status ELSE status END,
         last_compiled_at = CASE WHEN $10 THEN last_compiled_at ELSE now() END,
         entities = $11
         WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
        [
          job.tenantId,
          job.brainId,
          page.id,
          page.title,
          page.summary,
          page.body,
          page.version,
          page.content_hash,
          contradictions.length > 0,
          userEdited,
          page.entities,
        ],
      );
    } else {
      await client.query(
        `UPDATE pages SET entities = $4 WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
        [job.tenantId, job.brainId, page.id, page.entities],
      );
    }
    await recordPage(page, pageFacts, previousVersion, contradictions, changed);
  }

  if (isReview) {
    await client.query(
      `UPDATE jobs SET payload = payload || '{"applied":true}'::jsonb
       WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
      [job.tenantId, job.brainId, job.id],
    );
    await client.query(
      `UPDATE ingest_sources SET affected_page_ids = ARRAY(
        SELECT DISTINCT id FROM unnest(affected_page_ids || $4::text[]) AS id ORDER BY id)
       WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
      [...scope, [...affected].sort()],
    );
  } else {
    await client.query(
      `UPDATE ingest_sources SET status = 'completed', compiled_at = now(), affected_page_ids = $4,
       metadata = metadata || $5::jsonb, last_error = NULL, summary = $6
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
      [
        ...scope,
        [...affected].sort(),
        JSON.stringify({
          compilerPrompts: {
            extract: promptVersion("extract"),
            patch: promptVersion("patch"),
          },
        }),
        facts
          .map((fact) => fact.claim)
          .join("\n")
          .slice(0, 4_000),
      ],
    );
  }
  for (const event of routing) onRouting?.(event);
  if (affected.size > 0) {
    await client.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1, $2, 'connections.discover', $3, $4)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
      [
        job.tenantId,
        job.brainId,
        JSON.stringify({ brainId: job.brainId, pageIds: [...affected].sort() }),
        `connections:${sourceId}${isReview ? `:${job.id}` : ""}`,
      ],
    );
  }
  await enqueueScoreSnapshot(client, job.tenantId, job.brainId);
}
