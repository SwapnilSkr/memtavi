import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";

const pageColumns = `id, subject_id AS "subjectId", brain_id AS "brainId", slug, title, summary,
  body, page_type AS "pageType", bucket, bucket_source AS "bucketSource", status, pinned, archived,
  version, entities, backlinks, content_hash AS "contentHash",
  embedding_model AS "embeddingModel", last_compiled_at AS "lastCompiledAt",
  last_referenced_at AS "lastReferencedAt", user_edited_at AS "userEditedAt",
  deletion_state AS "deletionState"`;

const recency = `COALESCE(last_compiled_at, last_referenced_at)`;

export async function requireBrain(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
): Promise<void> {
  const result = await client.query(
    "SELECT id FROM brains WHERE tenant_id = $1 AND subject_id = $2 AND id = $3",
    [tenantId, subjectId, brainId],
  );
  if (!result.rowCount) throw new DomainError("NotFoundError", 404, "Not found");
}

export async function listPages(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'`,
    [tenantId, subjectId, brainId],
  );
  const items = await client.query(
    `SELECT ${pageColumns} FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'
     ORDER BY pinned DESC, ${recency} DESC NULLS LAST, slug, id
     LIMIT $4 OFFSET $5`,
    [tenantId, subjectId, brainId, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function getPageBySlug(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query(
    `UPDATE pages SET last_referenced_at = now()
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND slug = $4
     AND deletion_state = 'active'
     RETURNING ${pageColumns}`,
    [tenantId, subjectId, brainId, slug],
  );
  const page = result.rows[0];
  if (!page) throw new DomainError("NotFoundError", 404, "Not found");
  return page;
}

export async function getIndex(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'`,
    [tenantId, subjectId, brainId],
  );
  const items = await client.query(
    `SELECT slug, title, summary, page_type AS "pageType", pinned,
       COALESCE(last_compiled_at, last_referenced_at, to_timestamp(0)) AS "updatedAt"
     FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'
     ORDER BY pinned DESC,
       COALESCE(last_compiled_at, last_referenced_at, to_timestamp(0)) DESC,
       slug, id
     LIMIT $4 OFFSET $5`,
    [tenantId, subjectId, brainId, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}
