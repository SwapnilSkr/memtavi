import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import { requireBrain } from "./pages";
import { type Role, requireRole } from "./roles";

export const REVIEW_LIST_SQL = `
  SELECT r.id, r.ingest_source_id AS "sourceId",
    jsonb_build_object('claim', r.fact->'claim', 'entities', r.fact->'entities',
      'evidence', r.fact->'evidence') AS fact,
    COALESCE(jsonb_agg(jsonb_build_object('pageId', p.id, 'slug', p.slug, 'title', p.title)
      ORDER BY array_position(r.candidate_page_ids, p.id)) FILTER (WHERE p.id IS NOT NULL), '[]') AS candidates,
    r.best_gap AS "bestGap", r.status, r.resolution, r.created_at AS "createdAt"
  FROM (
    SELECT * FROM routing_reviews WHERE tenant_id = $1 AND brain_id = $2
      AND ($3::review_status IS NULL OR status = $3::review_status)
      AND ($6::uuid IS NULL OR id = $6)
    ORDER BY created_at DESC NULLS LAST, id LIMIT $4 OFFSET $5
  ) r
  LEFT JOIN pages p ON p.tenant_id = $1 AND p.brain_id = $2
    AND p.id = ANY(r.candidate_page_ids) AND p.deletion_state = 'active'
  GROUP BY r.id, r.ingest_source_id, r.fact, r.candidate_page_ids, r.best_gap,
    r.status, r.resolution, r.created_at
  ORDER BY r.created_at DESC NULLS LAST, r.id
`;

export async function listRoutingReviews(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  status: string,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM routing_reviews
     WHERE tenant_id = $1 AND brain_id = $2 AND status = $3::review_status`,
    [tenantId, brainId, status],
  );
  const items = await client.query(REVIEW_LIST_SQL, [
    tenantId,
    brainId,
    status,
    limit,
    offset,
    null,
  ]);
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function settleRoutingReview(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  reviewId: string,
  role: Role,
  decision: { pageId?: string; newPage?: true; note?: string } | null,
  note?: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query<{
    status: string;
    candidate_page_ids: string[];
    ingest_source_id: string;
  }>(
    `SELECT status, candidate_page_ids, ingest_source_id FROM routing_reviews
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 FOR UPDATE`,
    [tenantId, brainId, reviewId],
  );
  const review = result.rows[0];
  if (!review) throw new DomainError("NotFoundError", 404, "Not found");
  requireRole(role, "developer");
  if (review.status !== "open") {
    throw new DomainError("ConflictError", 409, "Review is already settled");
  }
  if (decision?.pageId) {
    const candidate = await client.query(
      `SELECT id FROM pages WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
       AND deletion_state = 'active' AND status IN ('active', 'contested') FOR SHARE`,
      [tenantId, brainId, decision.pageId],
    );
    if (!review.candidate_page_ids.includes(decision.pageId) || !candidate.rowCount) {
      throw new DomainError("BadRequestError", 400, "Page must be an active candidate");
    }
  }
  await client.query(
    `UPDATE routing_reviews SET status = $4::review_status, resolution = $5
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
    [
      tenantId,
      brainId,
      reviewId,
      decision ? "resolved" : "dismissed",
      decision?.note ?? note ?? null,
    ],
  );
  if (decision) {
    await client.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1, $2, 'review.apply', $3, $4)`,
      [
        tenantId,
        brainId,
        JSON.stringify({ reviewId, sourceId: review.ingest_source_id, brainId, ...decision }),
        `review:${reviewId}`,
      ],
    );
  }
  const response = await client.query(REVIEW_LIST_SQL, [tenantId, brainId, null, 1, 0, reviewId]);
  return response.rows[0];
}
