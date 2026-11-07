import type { EmbeddingProvider } from "@memtavi/llm/provider";
import type { PoolClient } from "pg";
import { requireBrain } from "./pages";

const RRF_K = 60;

interface KeywordRow {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  rank: number;
  updatedAt: Date;
}

interface SemanticRow {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  distance: number;
  updatedAt: Date;
}

interface Hit {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  similarity: number | null;
  updatedAt: Date;
}

interface Fused {
  hit: Hit;
  score: number;
}

export interface SearchOptions {
  q: string;
  limit: number;
  minSimilarity: number | null;
}

function addFused(fused: Map<string, Fused>, hit: Hit, score: number): void {
  const existing = fused.get(hit.pageId);
  if (existing) {
    existing.score += score;
    if (hit.similarity !== null) existing.hit.similarity = hit.similarity;
    return;
  }
  fused.set(hit.pageId, { hit, score });
}

export async function searchPages(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  options: SearchOptions,
  embeddings: EmbeddingProvider | null,
) {
  await requireBrain(client, tenantId, subjectId, brainId);

  const keyword = await client.query<KeywordRow>(
    `SELECT p.id AS "pageId", p.slug, p.title, p.summary, p.page_type AS "pageType",
       ts_rank(p.search_tsv, websearch_to_tsquery('english', $4)) AS "rank",
       COALESCE(p.last_compiled_at, p.last_referenced_at, to_timestamp(0)) AS "updatedAt"
     FROM pages p
     WHERE p.tenant_id = $1 AND p.subject_id = $2 AND p.brain_id = $3
     AND p.deletion_state = 'active'
     AND p.search_tsv @@ websearch_to_tsquery('english', $4)
     ORDER BY "rank" DESC, p.slug, p.id
     LIMIT $5`,
    [tenantId, subjectId, brainId, options.q, options.limit],
  );

  const keywordIds = new Set(keyword.rows.map((row) => row.pageId));
  const semantic = new Map<string, SemanticRow>();
  if (embeddings) {
    const embedded = await embeddings.embed([options.q]);
    const vector = embedded.vectors[0];
    if (vector) {
      const literal = `[${vector.join(",")}]`;
      const rows = await client.query<SemanticRow>(
        `SELECT p.id AS "pageId", p.slug, p.title, p.summary, p.page_type AS "pageType",
           (e.embedding <=> $4::vector) AS "distance",
           COALESCE(p.last_compiled_at, p.last_referenced_at, to_timestamp(0)) AS "updatedAt"
         FROM pages p
         JOIN page_embeddings e ON e.tenant_id = p.tenant_id AND e.page_id = p.id
         WHERE p.tenant_id = $1 AND p.subject_id = $2 AND p.brain_id = $3
         AND p.deletion_state = 'active' AND e.model = $5
         ORDER BY e.embedding <=> $4::vector, p.slug, p.id
         LIMIT $6`,
        [tenantId, subjectId, brainId, literal, embedded.model, options.limit],
      );
      for (const row of rows.rows) {
        const similarity = 1 - row.distance;
        if (options.minSimilarity !== null && similarity < options.minSimilarity) {
          if (!keywordIds.has(row.pageId)) continue;
        }
        semantic.set(row.pageId, row);
      }
    }
  }

  const fused = new Map<string, Fused>();
  keyword.rows.forEach((row, index) => {
    addFused(
      fused,
      {
        pageId: row.pageId,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        pageType: row.pageType,
        similarity: null,
        updatedAt: row.updatedAt,
      },
      1 / (RRF_K + index + 1),
    );
  });
  let semanticRank = 0;
  for (const row of semantic.values()) {
    semanticRank += 1;
    addFused(
      fused,
      {
        pageId: row.pageId,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        pageType: row.pageType,
        similarity: 1 - row.distance,
        updatedAt: row.updatedAt,
      },
      1 / (RRF_K + semanticRank),
    );
  }

  const items = [...fused.values()]
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.hit.slug !== right.hit.slug) return left.hit.slug < right.hit.slug ? -1 : 1;
      return left.hit.pageId < right.hit.pageId ? -1 : left.hit.pageId > right.hit.pageId ? 1 : 0;
    })
    .slice(0, options.limit)
    .map((entry) => entry.hit);

  return { items, total: items.length, limit: options.limit, offset: 0 };
}
