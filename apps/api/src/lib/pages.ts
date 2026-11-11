import type { EmbeddingProvider } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { contentHash } from "@memtavi/storage/keys";
import type { Static } from "elysia";
import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import type { pageUpdate } from "./schemas";

export const pageColumns = `id, subject_id AS "subjectId", brain_id AS "brainId", slug, title, summary,
  body, page_type AS "pageType", bucket, bucket_source AS "bucketSource", status, pinned, archived,
  version, entities, backlinks, content_hash AS "contentHash",
  embedding_model AS "embeddingModel", last_compiled_at AS "lastCompiledAt",
  last_referenced_at AS "lastReferencedAt", user_edited_at AS "userEditedAt",
  deletion_state AS "deletionState"`;

const recency = `COALESCE(last_compiled_at, last_referenced_at)`;

export interface LockedPage {
  id: string;
  version: number;
  title: string;
  summary: string;
  body: string;
  status: string;
  bucket: string;
  pinned: boolean;
  archived: boolean;
}

export type ChangeAction =
  | "created"
  | "updated"
  | "renamed"
  | "merged"
  | "split"
  | "archived"
  | "restored"
  | "recovered"
  | "routed";

export async function requireBrain(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT id FROM brains WHERE tenant_id = $1 AND subject_id = $2 AND id = $3
     AND deletion_state = 'active' FOR SHARE`,
    [tenantId, subjectId, brainId],
  );
  if (!result.rowCount) throw new DomainError("NotFoundError", 404, "Not found");
}

export async function lockPageBySlug(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
): Promise<LockedPage> {
  const result = await client.query<LockedPage>(
    `SELECT ${pageColumns} FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND slug = $4
     AND deletion_state = 'active'
     FOR UPDATE`,
    [tenantId, subjectId, brainId, slug],
  );
  const page = result.rows[0];
  if (!page) throw new DomainError("NotFoundError", 404, "Not found");
  return page;
}

export async function insertPageVersion(
  client: PoolClient,
  tenantId: string,
  pageId: string,
  version: number,
  title: string,
  summary: string,
  body: string,
): Promise<void> {
  await client.query(
    `INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, ingest_source_id, actor)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, 'user')`,
    [tenantId, pageId, version, title, summary, body],
  );
}

export async function insertChangeEvent(
  client: PoolClient,
  tenantId: string,
  brainId: string,
  pageId: string,
  action: ChangeAction,
  changeSummary: string,
  fromVersion: number | null,
  toVersion: number,
): Promise<string> {
  const id = newId("change");
  await client.query(
    `INSERT INTO change_events
       (id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version, contradictions)
     VALUES ($1, $2, $3, $4, $5::change_action, $6, $7, $8, '[]'::jsonb)`,
    [id, tenantId, brainId, pageId, action, changeSummary, fromVersion, toVersion],
  );
  return id;
}

export async function enqueueWebhooks(
  client: PoolClient,
  tenantId: string,
  brainId: string,
  eventId: string,
  subjectId: string,
  action: ChangeAction,
): Promise<void> {
  await client.query(
    `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
     SELECT $1, $2, 'webhook.deliver',
       jsonb_build_object('webhookId', w.id, 'eventId', $3::text),
       'webhook:' || $3::text || ':' || w.id::text,
       5
     FROM webhooks w
     WHERE w.tenant_id = $1 AND w.subject_id = $4 AND w.active = true
       AND $5::text = ANY(w.events)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
    [tenantId, brainId, eventId, subjectId, action],
  );
}

export async function listPages(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  status: string | null,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'
     AND ($4::page_status IS NULL OR status = $4::page_status)`,
    [tenantId, subjectId, brainId, status],
  );
  const items = await client.query(
    `SELECT ${pageColumns} FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'
     AND ($4::page_status IS NULL OR status = $4::page_status)
     ORDER BY pinned DESC, ${recency} DESC NULLS LAST, slug, id
     LIMIT $5 OFFSET $6`,
    [tenantId, subjectId, brainId, status, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function findPageBySlug(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
): Promise<{ id: string; version: number }> {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query<{ id: string; version: number }>(
    `SELECT id, version FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND slug = $4
     AND deletion_state = 'active'`,
    [tenantId, subjectId, brainId, slug],
  );
  const page = result.rows[0];
  if (!page) throw new DomainError("NotFoundError", 404, "Not found");
  return page;
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
  status: string | null,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'
     AND ($4::page_status IS NULL OR status = $4::page_status)`,
    [tenantId, subjectId, brainId, status],
  );
  const items = await client.query(
    `SELECT slug, title, summary, page_type AS "pageType", pinned, status,
       COALESCE(last_compiled_at, last_referenced_at, to_timestamp(0)) AS "updatedAt"
     FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'
     AND ($4::page_status IS NULL OR status = $4::page_status)
     ORDER BY pinned DESC,
       COALESCE(last_compiled_at, last_referenced_at, to_timestamp(0)) DESC,
       slug, id
     LIMIT $5 OFFSET $6`,
    [tenantId, subjectId, brainId, status, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function deletePagePermanently(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
  permanent: string | undefined,
) {
  if (permanent !== "true") {
    throw new DomainError("BadRequestError", 400, "permanent=true is required");
  }
  await requireBrain(client, tenantId, subjectId, brainId);
  const found = await client.query<{ id: string }>(
    `SELECT id FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND slug = $4
     AND deletion_state = 'active'
     FOR UPDATE`,
    [tenantId, subjectId, brainId, slug],
  );
  const page = found.rows[0];
  if (!page) throw new DomainError("NotFoundError", 404, "Not found");
  await client.query(
    `INSERT INTO deletion_ops (tenant_id, brain_id, target_type, target_id, state, detail)
     VALUES ($1, $2, 'page', $3, 'deleted', jsonb_build_object('deletedAt', now()))`,
    [tenantId, brainId, page.id],
  );
  await client.query("DELETE FROM pages WHERE tenant_id = $1 AND id = $2", [tenantId, page.id]);
  return { id: page.id, targetType: "page", state: "deleted" };
}

export async function refreshPageEmbedding(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  pageId: string,
  embeddingText: string,
  hash: string,
  embeddings: EmbeddingProvider,
): Promise<unknown> {
  await client.query("SAVEPOINT page_embedding");
  try {
    const embedded = await embeddings.embed([embeddingText]);
    const vector = embedded.vectors[0];
    if (!vector) {
      await client.query("RELEASE SAVEPOINT page_embedding");
      return null;
    }
    await client.query(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       VALUES ($1, $2, $3, $4, $5::vector, $6)
       ON CONFLICT (page_id, model) DO UPDATE SET embedding = EXCLUDED.embedding,
       dimensions = EXCLUDED.dimensions, content_hash = EXCLUDED.content_hash
       WHERE page_embeddings.tenant_id = $1`,
      [tenantId, pageId, embedded.model, embedded.dimensions, JSON.stringify(vector), hash],
    );
    const embeddedPage = await client.query(
      `UPDATE pages SET embedding_model = $5
       WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
       RETURNING ${pageColumns}`,
      [tenantId, subjectId, brainId, pageId, embedded.model],
    );
    await client.query("RELEASE SAVEPOINT page_embedding");
    return embeddedPage.rows[0] ?? null;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT page_embedding");
    return null;
  }
}

export async function updatePageBySlug(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
  update: Static<typeof pageUpdate>,
  embeddings: EmbeddingProvider | null,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const page = await lockPageBySlug(client, tenantId, subjectId, brainId, slug);
  if (update.version !== undefined && update.version !== page.version) {
    throw new DomainError("ConflictError", 409, "Version conflict");
  }

  const title = update.title ?? page.title;
  const summary = update.summary ?? page.summary;
  const body = update.body ?? page.body;
  const embeddingText = `${title}\n${summary}\n${body}`;
  const hash = contentHash(embeddingText);
  const version = page.version + 1;

  const updated = await client.query(
    `UPDATE pages SET title = $5, summary = $6, body = $7, bucket = $8, pinned = $9,
       archived = $10, status = $11, content_hash = $12, version = $13,
       user_edited_at = now()
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
     RETURNING ${pageColumns}`,
    [
      tenantId,
      subjectId,
      brainId,
      page.id,
      title,
      summary,
      body,
      update.bucket ?? page.bucket,
      update.pinned ?? page.pinned,
      update.archived ?? page.archived,
      update.status ?? page.status,
      hash,
      version,
    ],
  );

  await insertPageVersion(client, tenantId, page.id, version, title, summary, body);
  const eventId = await insertChangeEvent(
    client,
    tenantId,
    brainId,
    page.id,
    "updated",
    "Edited by user",
    page.version,
    version,
  );
  await enqueueWebhooks(client, tenantId, brainId, eventId, subjectId, "updated");

  let result = updated.rows[0];
  if (embeddings) {
    const embeddedPage = await refreshPageEmbedding(
      client,
      tenantId,
      subjectId,
      brainId,
      page.id,
      embeddingText,
      hash,
      embeddings,
    );
    if (embeddedPage) result = embeddedPage;
  }

  return result;
}
