import { chunkBody } from "@memtavi/core/compile/chunk";
import { CompileError, extractFacts } from "@memtavi/core/compile/extract";
import { applyPatch, buildPatchMessages, parsePatchResult } from "@memtavi/core/compile/patch";
import { decideMws } from "@memtavi/core/compile/policies/mws";
import { decidePfs } from "@memtavi/core/compile/policies/pfs";
import { promptVersion } from "@memtavi/core/compile/prompts";
import type { ExtractedFact, PatchResult } from "@memtavi/core/compile/schemas";
import { chatCostUsd, embeddingCostUsd } from "@memtavi/llm/cost";
import { type ChatResult, type EmbeddingResult, ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { chunkKey, contentHash } from "@memtavi/storage/keys";
import { StorageError } from "@memtavi/storage/types";
import { type JobContext, JobError } from "./types";

interface SourceRow {
  content: string;
  body_ref: string | null;
  subject_id: string;
  status: string;
  deleted_at: Date | null;
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
}

export const CANDIDATES_SQL = `
  SELECT p.id, p.slug,
    COALESCE((SELECT v.created_at FROM page_versions v
      WHERE v.tenant_id = p.tenant_id AND v.page_id = p.id AND v.version = 1), 'epoch'::timestamptz) AS "createdAt",
    greatest(0, least(1, 1 - (e.embedding <=> $1::vector))) AS score
  FROM pages p JOIN page_embeddings e ON e.tenant_id = p.tenant_id AND e.page_id = p.id
  WHERE p.tenant_id = $2 AND p.brain_id = $3 AND e.model = $4 AND e.dimensions = 1536
    AND p.status IN ('active', 'contested') AND p.deletion_state = 'active'
  ORDER BY e.embedding <=> $1::vector, "createdAt", p.slug, p.id
  LIMIT 5
`;

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
}: JobContext): Promise<void> {
  const sourceId = job.payload.sourceId;
  if (typeof sourceId !== "string" || !sourceId || job.payload.brainId !== job.brainId) {
    throw new JobError("permanent", "Invalid job payload");
  }
  const scope = [job.tenantId, job.brainId, sourceId];
  await client.query(
    "SELECT id FROM brains WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE",
    scope.slice(0, 2),
  );
  const sources = await client.query<SourceRow>(
    `SELECT content, body_ref, subject_id, status, deleted_at FROM ingest_sources
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 FOR UPDATE`,
    scope,
  );
  const source = sources.rows[0];
  if (!source || source.deleted_at || source.status === "completed") return;
  if (!compiler) throw new JobError("permanent", "Compiler configuration is required");
  const { chatProvider, embeddingProvider, chatModel, embeddingModel } = compiler;
  const body = source.body_ref
    ? await new Response(await store.get(source.body_ref)).text()
    : source.content;
  const chunks: { chunkUuid: string; text: string }[] = [];
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
  for (let start = 0; start < chunks.length; start += 8) {
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
  const vectors = facts.length ? (await embed(facts.map((fact) => fact.claim))).vectors : [];
  const affected = new Set<string>();
  for (const [index, fact] of facts.entries()) {
    const vector = vectors[index];
    if (!vector) throw new JobError("permanent", "Missing fact embedding");
    const candidates = await client.query<{
      id: string;
      slug: string;
      createdAt: Date;
      score: number;
    }>(CANDIDATES_SQL, [JSON.stringify(vector), job.tenantId, job.brainId, embeddingModel]);
    const decision = decidePfs(
      candidates.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    );
    if (decision.action === "review") {
      await client.query(
        `INSERT INTO routing_reviews
         (tenant_id, brain_id, ingest_source_id, fact, candidate_page_ids, best_gap)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [...scope, JSON.stringify(fact), decision.candidateIds, decision.gap],
      );
      continue;
    }
    let page: PageRow;
    let previousVersion: number | null = null;
    let contradictions: PatchResult["contradictions"] = [];
    let changed = true;
    if (decision.action === "place") {
      const found = await client.query<PageRow>(
        `SELECT id, title, summary, body, version, content_hash, user_edited_at, last_compiled_at
         FROM pages WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
         AND deletion_state = 'active' AND status IN ('active', 'contested') FOR UPDATE`,
        [job.tenantId, job.brainId, decision.pageId],
      );
      const existing = found.rows[0];
      if (!existing) throw new JobError("transient", "Routing page changed");
      const userEdited =
        existing.user_edited_at !== null &&
        (existing.last_compiled_at === null || existing.user_edited_at > existing.last_compiled_at);
      const response = await chatProvider.chat({
        model: chatModel,
        temperature: 0,
        responseFormat: "json",
        messages: buildPatchMessages(existing, [fact], {
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
        facts: [fact],
      });
      contradictions = patch.contradictions;
      changed = patch.changed || contradictions.length > 0;
      previousVersion = existing.version;
      page = {
        ...existing,
        title: patch.title,
        summary: patch.summary,
        body: patch.body,
        version: existing.version + (changed ? 1 : 0),
      };
      page.content_hash = contentHash(`${page.title}\n${page.summary}\n${page.body}`);
      if (changed) {
        await client.query(
          `UPDATE pages SET title = $4, summary = $5, body = $6, version = $7, content_hash = $8,
           status = CASE WHEN $9 THEN 'contested'::page_status ELSE status END,
           last_compiled_at = CASE WHEN $10 THEN last_compiled_at ELSE now() END
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
          ],
        );
      }
    } else {
      const title = fact.claim.trim().slice(0, 120);
      const pageBody = `${fact.claim}\n\n## Sources\n- ${fact.evidence.chunkUuid}:${fact.evidence.charStart}-${fact.evidence.charEnd} ${JSON.stringify(fact.evidence.quote)}`;
      page = {
        id: newId("page"),
        title,
        summary: fact.claim,
        body: pageBody,
        version: 1,
        content_hash: contentHash(`${title}\n${fact.claim}\n${pageBody}`),
        user_edited_at: null,
        last_compiled_at: null,
      };
      const baseSlug =
        title
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "topic";
      const suffix = contentHash(`${sourceId}\n${index}\n${fact.claim}`).slice(0, 12);
      let attempt = 0;
      while (true) {
        const slug =
          attempt === 0 ? baseSlug : `${baseSlug}-${suffix}${attempt > 1 ? `-${attempt}` : ""}`;
        const inserted = await client.query(
          `INSERT INTO pages
           (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, content_hash, last_compiled_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'topic', $9, now())
           ON CONFLICT (brain_id, slug) WHERE deletion_state = 'active' DO NOTHING`,
          [
            page.id,
            job.tenantId,
            source.subject_id,
            job.brainId,
            slug,
            title,
            fact.claim,
            page.body,
            page.content_hash,
          ],
        );
        if (inserted.rowCount) break;
        attempt += 1;
      }
    }
    affected.add(page.id);
    if (changed) {
      await client.query(
        `INSERT INTO page_versions
         (tenant_id, page_id, version, title, summary, body, ingest_source_id, actor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'compiler')`,
        [job.tenantId, page.id, page.version, page.title, page.summary, page.body, sourceId],
      );
      await client.query(
        `INSERT INTO change_events
         (id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version, ingest_source_id, contradictions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          newId("change"),
          job.tenantId,
          job.brainId,
          page.id,
          previousVersion === null ? "created" : "updated",
          fact.claim,
          previousVersion,
          page.version,
          sourceId,
          JSON.stringify(contradictions),
        ],
      );
    }
    await client.query(
      `INSERT INTO page_sources (tenant_id, page_id, ingest_source_id, chunk_uuids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (page_id, ingest_source_id) DO UPDATE SET chunk_uuids = ARRAY(
         SELECT DISTINCT chunk FROM unnest(page_sources.chunk_uuids || EXCLUDED.chunk_uuids) AS chunk ORDER BY chunk)
       WHERE page_sources.tenant_id = $1`,
      [job.tenantId, page.id, sourceId, [fact.evidence.chunkUuid]],
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
  await client.query(
    `UPDATE ingest_sources SET status = 'completed', compiled_at = now(), affected_page_ids = $4,
       metadata = metadata || $5::jsonb, last_error = NULL
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
    ],
  );
}
