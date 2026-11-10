import { createHash } from "node:crypto";
import { newId } from "@memtavi/shared/ids";
import { sourceKey } from "@memtavi/storage/keys";
import type { ObjectStore } from "@memtavi/storage/types";
import type { Static } from "elysia";
import type { PoolClient } from "pg";
import type { Auth } from "../middleware/auth";
import { DomainError } from "../middleware/errors";
import type { captureCreate } from "./schemas";

const PREVIEW_LIMIT = 4_000;
const SIGNED_URL_TTL_SECONDS = 300;

const fields = [
  "id",
  "brainId",
  "kind",
  "contentPreview",
  "contentUrl",
  "contentHash",
  "originRef",
  "label",
  "bucket",
  "metadata",
  "status",
  "attempts",
  "lastError",
  "affectedPageIds",
  "originalBytes",
  "createdAt",
  "compiledAt",
  "deletedAt",
] as const;

export const sourceColumns = `id, brain_id AS "brainId", kind, content AS "contentPreview",
  content_hash AS "contentHash", body_ref AS "bodyRef",
  origin_ref AS "originRef", label, bucket, metadata, status, attempts,
  last_error AS "lastError", affected_page_ids AS "affectedPageIds",
  original_bytes AS "originalBytes", created_at AS "createdAt", compiled_at AS "compiledAt",
  deleted_at AS "deletedAt"`;

type Row = Record<string, unknown>;

interface StoredResponse {
  status: number;
  body: Record<string, unknown>;
}

export function sourceBody(row: Row): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) body[field] = row[field] ?? null;
  return body;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(body: Static<typeof captureCreate>) {
  const content = body.content ?? null;
  const fetchUrl = body.fetchUrl ?? null;
  if (content === null ? fetchUrl === null : fetchUrl !== null) {
    throw new DomainError("BadRequestError", 400, "Supply exactly one of content or fetchUrl");
  }
  if (content !== null && content.length > 50_000) {
    throw new DomainError("BadRequestError", 400, "Inline content exceeds 50000 characters");
  }
  if (fetchUrl !== null) {
    let url: URL;
    try {
      url = new URL(fetchUrl);
    } catch {
      throw new DomainError("BadRequestError", 400, "Invalid fetchUrl");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new DomainError("BadRequestError", 400, "fetchUrl must be http or https");
    }
  }
  return { content, fetchUrl };
}

async function requireBrain(
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

async function replay(
  client: PoolClient,
  tenantId: string,
  scope: string,
  key: string,
  requestHash: string,
): Promise<StoredResponse | null> {
  const result = await client.query<{
    requestHash: string;
    responseStatus: number;
    responseBody: Row;
    live: boolean;
  }>(
    `SELECT request_hash AS "requestHash", response_status AS "responseStatus",
       response_body AS "responseBody", expires_at > now() AS live
     FROM idempotency_keys WHERE tenant_id = $1 AND scope = $2 AND key = $3 FOR UPDATE`,
    [tenantId, scope, key],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!row.live) {
    await client.query(
      "DELETE FROM idempotency_keys WHERE tenant_id = $1 AND scope = $2 AND key = $3",
      [tenantId, scope, key],
    );
    return null;
  }
  if (row.requestHash !== requestHash) {
    throw new DomainError("ConflictError", 409, "Idempotency-Key reused with a different request");
  }
  return { status: row.responseStatus, body: sourceBody(row.responseBody) };
}

async function remember(
  client: PoolClient,
  tenantId: string,
  scope: string,
  key: string,
  requestHash: string,
  stored: StoredResponse,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys
       (tenant_id, scope, key, request_hash, response_status, response_body, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '24 hours')
     ON CONFLICT (tenant_id, scope, key) DO UPDATE SET
       request_hash = EXCLUDED.request_hash, response_status = EXCLUDED.response_status,
       response_body = EXCLUDED.response_body, expires_at = EXCLUDED.expires_at`,
    [tenantId, scope, key, requestHash, stored.status, JSON.stringify(stored.body)],
  );
}

async function findOrigin(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  originRef: string,
) {
  const result = await client.query(
    `SELECT ${sourceColumns} FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND origin_ref = $4
     AND deleted_at IS NULL`,
    [tenantId, subjectId, brainId, originRef],
  );
  return result.rows[0] as Row | undefined;
}

export async function createCapture(
  client: PoolClient,
  store: ObjectStore,
  auth: Auth,
  subjectId: string,
  brainId: string,
  body: Static<typeof captureCreate>,
  idempotencyKey: string | null,
): Promise<StoredResponse> {
  const { content, fetchUrl } = normalize(body);
  const tenantId = auth.tenantId;
  await requireBrain(client, tenantId, subjectId, brainId);

  const scope = `POST /v1/brains/${brainId}/captures`;
  const requestHash = hash(canonical(body));
  if (idempotencyKey !== null) {
    const stored = await replay(client, tenantId, scope, idempotencyKey, requestHash);
    if (stored) return stored;
  }

  const originRef = body.originRef ?? null;
  let status = 201;
  let row: Row | undefined;
  if (originRef !== null) {
    row = await findOrigin(client, tenantId, subjectId, brainId, originRef);
    if (row) status = 200;
  }

  if (!row) {
    const id = newId("source");
    const raw = content ?? fetchUrl ?? "";
    let bodyRef: string | null = null;
    let bodyBytes = 0;
    let preview = raw;
    if (content !== null) {
      bodyRef = sourceKey({ tenantId, sourceId: id, body: content });
      bodyBytes = Buffer.byteLength(content, "utf8");
      preview = content.slice(0, PREVIEW_LIMIT);
      await store.put(bodyRef, content, "text/plain; charset=utf-8");
    }
    const inserted = await client.query(
      `INSERT INTO ingest_sources
         (id, tenant_id, subject_id, brain_id, kind, content, content_hash, origin_ref,
          label, bucket, metadata, original_bytes, body_ref, body_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (brain_id, origin_ref)
         WHERE origin_ref IS NOT NULL AND deleted_at IS NULL DO NOTHING
       RETURNING ${sourceColumns}`,
      [
        id,
        tenantId,
        subjectId,
        brainId,
        body.kind,
        preview,
        hash(raw),
        originRef,
        body.label ?? null,
        body.bucket ?? "inbox",
        JSON.stringify(body.metadata ?? {}),
        content === null ? 0 : Buffer.byteLength(content, "utf8"),
        bodyRef,
        bodyBytes,
      ],
    );
    row = inserted.rows[0] as Row | undefined;
    if (row) {
      await client.query(
        `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
         VALUES ($1, $2, 'capture.ingest', $3, $4, 5)`,
        [tenantId, brainId, JSON.stringify({ sourceId: id, brainId }), `capture:${id}`],
      );
    } else if (originRef !== null) {
      row = await findOrigin(client, tenantId, subjectId, brainId, originRef);
      status = 200;
    }
  }

  if (!row) throw new DomainError("InternalServerError", 500, "Internal server error");

  const stored: StoredResponse = { status, body: sourceBody(row) };
  if (idempotencyKey !== null) {
    await remember(client, tenantId, scope, idempotencyKey, requestHash, stored);
  }
  return stored;
}

export async function retrySource(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  sourceId: string,
): Promise<Record<string, unknown>> {
  await requireBrain(client, tenantId, subjectId, brainId);
  const found = await client.query(
    `SELECT ${sourceColumns}, cardinality(chunk_uuids) AS "chunkCount"
     FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
     AND deleted_at IS NULL FOR UPDATE`,
    [tenantId, subjectId, brainId, sourceId],
  );
  const row = found.rows[0] as Row | undefined;
  if (!row) throw new DomainError("NotFoundError", 404, "Not found");
  if (row.status !== "failed") throw new DomainError("ConflictError", 409, "Source has not failed");

  const attempts = Number(row.attempts ?? 0) + 1;
  const storedBody = row.bodyRef !== null || Number(row.chunkCount ?? 0) > 0;
  const updated = await client.query(
    `UPDATE ingest_sources SET status = 'pending', last_error = NULL, attempts = $5
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
     RETURNING ${sourceColumns}`,
    [tenantId, subjectId, brainId, sourceId, attempts],
  );
  await client.query(
    `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
     VALUES ($1, $2, $3, $4, $5, 5)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
    [
      tenantId,
      brainId,
      storedBody ? "capture.compile" : "capture.ingest",
      JSON.stringify({ sourceId, brainId }),
      `retry:${sourceId}:${attempts}`,
    ],
  );
  const result = updated.rows[0] as Row | undefined;
  if (!result) throw new DomainError("InternalServerError", 500, "Internal server error");
  return sourceBody(result);
}

export async function listSources(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deleted_at IS NULL`,
    [tenantId, subjectId, brainId],
  );
  const items = await client.query(
    `SELECT ${sourceColumns} FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deleted_at IS NULL
     ORDER BY created_at DESC NULLS LAST, id LIMIT $4 OFFSET $5`,
    [tenantId, subjectId, brainId, limit, offset],
  );
  return {
    items: (items.rows as Row[]).map(sourceBody),
    total: total.rows[0]?.total ?? 0,
    limit,
    offset,
  };
}

export async function getSource(
  client: PoolClient,
  store: ObjectStore,
  tenantId: string,
  subjectId: string,
  brainId: string,
  sourceId: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query(
    `SELECT ${sourceColumns} FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
     AND deleted_at IS NULL`,
    [tenantId, subjectId, brainId, sourceId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new DomainError("NotFoundError", 404, "Not found");
  const body = sourceBody(row);
  const bodyRef = row.bodyRef;
  body.contentUrl =
    typeof bodyRef === "string" && bodyRef !== ""
      ? await store.signedUrl(bodyRef, SIGNED_URL_TTL_SECONDS)
      : null;
  return body;
}

export async function getSourceContent(
  client: PoolClient,
  store: ObjectStore,
  now: () => Date,
  tenantId: string,
  subjectId: string,
  brainId: string,
  sourceId: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query<{ bodyRef: string | null }>(
    `SELECT body_ref AS "bodyRef" FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4
     AND deleted_at IS NULL`,
    [tenantId, subjectId, brainId, sourceId],
  );
  const bodyRef = result.rows[0]?.bodyRef;
  if (bodyRef === null || bodyRef === undefined || bodyRef === "") {
    throw new DomainError("NotFoundError", 404, "Not found");
  }
  const url = await store.signedUrl(bodyRef, SIGNED_URL_TTL_SECONDS);
  if (url === null) return { url: null, expiresAt: null };
  const expiresAt = new Date(now().getTime() + SIGNED_URL_TTL_SECONDS * 1_000).toISOString();
  return { url, expiresAt };
}

export async function deleteSource(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  sourceId: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const found = await client.query(
    `SELECT id FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4`,
    [tenantId, subjectId, brainId, sourceId],
  );
  if (!found.rowCount) throw new DomainError("NotFoundError", 404, "Not found");
  await client.query(
    `UPDATE ingest_sources SET deleted_at = COALESCE(deleted_at, now())
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND id = $4`,
    [tenantId, subjectId, brainId, sourceId],
  );
  return { id: sourceId, targetType: "source", state: "deleted" };
}
