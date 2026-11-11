import {
  buildConnectMessages,
  type ConnectionPage,
  type ConnectionPair,
  parseConnectResult,
} from "@memtavi/core/compile/connect";
import { CompileError } from "@memtavi/core/compile/extract";
import {
  CONNECTION_CANDIDATE_COUNT,
  CONNECTION_SIMILARITY_FLOOR,
  canonicalPair,
  isConnectionCandidate,
} from "@memtavi/core/compile/policies/crs";
import { promptVersion } from "@memtavi/core/compile/prompts";
import { chatCostUsd } from "@memtavi/llm/cost";
import { ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { assertBudget } from "./budget";
import { type JobContext, JobError } from "./types";

export const CONNECTION_CANDIDATES_SQL = `
  SELECT p.id, p.title, p.summary, p.body,
    greatest(0, least(1, 1 - (e.embedding <=> origin.embedding))) AS similarity
  FROM pages source
  JOIN page_embeddings origin ON origin.tenant_id = source.tenant_id AND origin.page_id = source.id
  JOIN pages p ON p.tenant_id = source.tenant_id AND p.brain_id = source.brain_id AND p.id <> source.id
  JOIN page_embeddings e ON e.tenant_id = p.tenant_id AND e.page_id = p.id
    AND e.model = origin.model AND e.dimensions = origin.dimensions
  WHERE source.id = $1 AND source.tenant_id = $2 AND source.brain_id = $3
    AND source.status IN ('active', 'contested') AND source.deletion_state = 'active' AND NOT source.archived
    AND p.status IN ('active', 'contested') AND p.deletion_state = 'active' AND NOT p.archived
    AND origin.model = $4 AND origin.dimensions = 1536
    AND 1 - (e.embedding <=> origin.embedding) >= $5
    AND NOT EXISTS (
      SELECT 1 FROM connections c WHERE c.tenant_id = $2 AND c.brain_id = $3
        AND c.page_a_id = least(source.id, p.id) AND c.page_b_id = greatest(source.id, p.id)
        AND c.source = 'manual'
    )
  ORDER BY e.embedding <=> origin.embedding,
    COALESCE((SELECT v.created_at FROM page_versions v
      WHERE v.tenant_id = p.tenant_id AND v.page_id = p.id AND v.version = 1), 'epoch'::timestamptz),
    p.slug, p.id
  LIMIT $6
`;

type ConnectionContext = Omit<JobContext, "client">;

export async function discoverConnections(context: ConnectionContext): Promise<void> {
  try {
    await discover(context);
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new JobError(error.transient ? "transient" : "permanent", "Connection provider failed");
    }
    if (error instanceof CompileError) {
      throw new JobError("permanent", "Invalid connection output");
    }
    throw error;
  }
}

async function discover({
  job,
  compiler,
  recordUsage,
  withTenant,
}: ConnectionContext): Promise<void> {
  const pageIds = job.payload.pageIds;
  if (
    job.payload.brainId !== job.brainId ||
    !Array.isArray(pageIds) ||
    !pageIds.every((id): id is string => typeof id === "string" && id.length > 0)
  ) {
    throw new JobError("permanent", "Invalid connection job payload");
  }
  if (!withTenant) throw new JobError("permanent", "Tenant transactions are required");
  const scope = [job.tenantId, job.brainId];
  if (!compiler?.chatModel.trim() || /latest/i.test(compiler.chatModel)) {
    throw new JobError("permanent", "Pinned compiler configuration is required");
  }
  const pairs = await withTenant(job.tenantId, async (client) => {
    const brain = await client.query(
      `SELECT id FROM brains WHERE tenant_id = $1 AND id = $2
       AND deletion_state = 'active'`,
      scope,
    );
    if (!brain.rowCount) return null;
    const current = await client.query<{ applied: boolean }>(
      `SELECT COALESCE((payload->>'connectionsApplied')::boolean, false) AS applied
       FROM jobs WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
      [...scope, job.id],
    );
    if (!current.rowCount) throw new JobError("permanent", "Missing connection job");
    if (current.rows[0]?.applied) return null;
    const pairs = new Map<string, ConnectionPair>();
    for (const pageId of [...new Set(pageIds)].sort()) {
      const source = (
        await client.query<ConnectionPage>(
          `SELECT id, title, summary, body FROM pages
         WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
         AND deletion_state = 'active' AND status IN ('active', 'contested') AND NOT archived`,
          [...scope, pageId],
        )
      ).rows[0];
      if (!source) continue;
      const candidates = await client.query<ConnectionPage & { similarity: number }>(
        CONNECTION_CANDIDATES_SQL,
        [
          pageId,
          ...scope,
          compiler.embeddingModel,
          CONNECTION_SIMILARITY_FLOOR,
          CONNECTION_CANDIDATE_COUNT,
        ],
      );
      for (const candidate of candidates.rows) {
        if (!isConnectionCandidate(candidate.similarity)) continue;
        const [pageAId] = canonicalPair(source.id, candidate.id);
        const pair = {
          pageA: pageAId === source.id ? source : candidate,
          pageB: pageAId === source.id ? candidate : source,
          similarity: candidate.similarity,
        };
        pairs.set(`${pair.pageA.id}:${pair.pageB.id}`, pair);
      }
    }
    if (pairs.size) {
      await assertBudget(client, job.tenantId);
      await client.query(
        `UPDATE jobs SET payload = payload || $4::jsonb
         WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
        [
          ...scope,
          job.id,
          JSON.stringify({
            connectionPrompt: { model: compiler.chatModel, promptHash: promptVersion("connect") },
          }),
        ],
      );
    }
    return pairs;
  });
  if (!pairs) return;
  const ordered = [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let judgements: ReturnType<typeof parseConnectResult> = [];
  if (ordered.length) {
    const model = compiler.chatModel;
    const response = await compiler.chatProvider.chat({
      model,
      messages: buildConnectMessages(ordered.map(([, pair]) => pair)),
      temperature: 0,
      responseFormat: "json",
    });
    const usage = {
      provider: "openrouter",
      model: response.model,
      kind: "chat" as const,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: chatCostUsd(
        response.usage.inputTokens,
        response.usage.outputTokens,
        compiler.chatPrices,
      ),
    };
    if (recordUsage) await recordUsage(usage);
    else {
      await withTenant(job.tenantId, async (client) => {
        await client.query(
          `INSERT INTO usage_ledger
         (tenant_id, brain_id, job_id, provider, model, kind, input_tokens, output_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ...scope,
            job.id,
            usage.provider,
            usage.model,
            usage.kind,
            usage.inputTokens,
            usage.outputTokens,
            usage.costUsd,
          ],
        );
      });
    }
    if (response.model !== model) throw new CompileError();
    judgements = parseConnectResult(
      response.text,
      ordered.map(([, pair]) => pair),
    );
  }
  await withTenant(job.tenantId, async (client) => {
    const brain = await client.query(
      `SELECT id FROM brains WHERE tenant_id = $1 AND id = $2
       AND deletion_state = 'active' FOR SHARE`,
      scope,
    );
    if (!brain.rowCount) return;
    const current = await client.query<{ applied: boolean }>(
      `SELECT COALESCE((payload->>'connectionsApplied')::boolean, false) AS applied
       FROM jobs WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 FOR UPDATE`,
      [...scope, job.id],
    );
    if (!current.rowCount) throw new JobError("permanent", "Missing connection job");
    if (current.rows[0]?.applied) return;
    for (const judgement of judgements) {
      const pair = pairs.get(`${judgement.pageAId}:${judgement.pageBId}`);
      if (!pair) throw new CompileError();
      const pages = await client.query(
        `SELECT id FROM pages
         WHERE tenant_id = $1 AND brain_id = $2 AND id = ANY($3::text[])
           AND deletion_state = 'active' AND status IN ('active', 'contested') AND NOT archived
         ORDER BY id FOR SHARE`,
        [...scope, [judgement.pageAId, judgement.pageBId]],
      );
      if (pages.rowCount !== 2) continue;
      const existing = (
        await client.query<{ source: string }>(
          `SELECT source FROM connections
           WHERE tenant_id = $1 AND brain_id = $2 AND page_a_id = $3 AND page_b_id = $4 FOR UPDATE`,
          [...scope, judgement.pageAId, judgement.pageBId],
        )
      ).rows[0];
      if (existing?.source === "manual") continue;
      const id = newId("connection");
      await client.query(
        `INSERT INTO connections
         (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto')
         ON CONFLICT (brain_id, page_a_id, page_b_id) DO UPDATE
         SET similarity = EXCLUDED.similarity, strength = EXCLUDED.strength, reasoning = EXCLUDED.reasoning,
           acked_at = CASE WHEN
             array_position(ARRAY['weak', 'medium', 'strong'], EXCLUDED.strength::text) >
             array_position(ARRAY['weak', 'medium', 'strong'], connections.strength::text)
             THEN NULL ELSE connections.acked_at END
         WHERE connections.tenant_id = $2 AND connections.source = 'auto'`,
        [
          id,
          ...scope,
          judgement.pageAId,
          judgement.pageBId,
          pair.similarity,
          judgement.strength,
          judgement.reasoning,
        ],
      );
    }
    await client.query(
      `UPDATE jobs SET payload = payload || '{"connectionsApplied":true}'::jsonb
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
      [...scope, job.id],
    );
  });
}
