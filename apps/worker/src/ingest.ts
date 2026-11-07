import { createHash } from "node:crypto";
import { sourceKey } from "@memtavi/storage/keys";
import type { ObjectStore } from "@memtavi/storage/types";
import type { PoolClient } from "pg";
import { type JobContext, JobError } from "./types";

const PREVIEW_LIMIT = 4_000;

interface SourceRow {
  id: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
}

const SOURCE_SQL = `
  SELECT id, kind, content, metadata FROM ingest_sources
  WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 AND deleted_at IS NULL
`;

const COMPILING_SQL = `
  UPDATE ingest_sources SET status = 'compiling', last_error = NULL
  WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
`;

const STORE_SQL = `
  UPDATE ingest_sources
  SET content = $4, content_hash = $5, original_bytes = $6, body_ref = $7, body_bytes = $8,
      metadata = metadata || $9::jsonb, status = 'compiling', last_error = NULL
  WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
`;

const ENQUEUE_SQL = `
  INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
  VALUES ($1, $2, 'capture.compile', $3, $4, 5)
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function payloadOf(payload: Record<string, unknown>): { sourceId: string; brainId: string } {
  const sourceId = payload.sourceId;
  const brainId = payload.brainId;
  if (
    typeof sourceId !== "string" ||
    sourceId === "" ||
    typeof brainId !== "string" ||
    brainId === ""
  ) {
    throw new JobError("permanent", "Invalid job payload");
  }
  return { sourceId, brainId };
}

async function storeFetched(
  client: PoolClient,
  store: ObjectStore,
  tenantId: string,
  brainId: string,
  sourceId: string,
  fetched: { status: number; finalUrl: string; contentType: string | null; text: string },
): Promise<void> {
  if (fetched.status >= 400) {
    const transient = fetched.status >= 500 || fetched.status === 429;
    throw new JobError(
      transient ? "transient" : "permanent",
      transient ? "Upstream error" : "Upstream rejected the request",
    );
  }
  const metadata = {
    finalUrl: fetched.finalUrl,
    fetchStatus: fetched.status,
    contentType: fetched.contentType,
  };
  const bodyRef = sourceKey({ tenantId, sourceId, body: fetched.text });
  await store.put(bodyRef, fetched.text, "text/plain; charset=utf-8");
  const bytes = Buffer.byteLength(fetched.text, "utf8");
  await client.query(STORE_SQL, [
    tenantId,
    brainId,
    sourceId,
    fetched.text.slice(0, PREVIEW_LIMIT),
    sha256(fetched.text),
    bytes,
    bodyRef,
    bytes,
    JSON.stringify(metadata),
  ]);
}

export async function ingestCapture({
  job,
  client,
  store,
  fetchDocument,
}: JobContext): Promise<void> {
  const { sourceId, brainId } = payloadOf(job.payload);
  const result = await client.query<SourceRow>(SOURCE_SQL, [job.tenantId, brainId, sourceId]);
  const source = result.rows[0];
  if (!source) throw new JobError("permanent", "Source not found");

  if (source.kind === "url") {
    await storeFetched(
      client,
      store,
      job.tenantId,
      brainId,
      sourceId,
      await fetchDocument(source.content),
    );
  } else {
    await client.query(COMPILING_SQL, [job.tenantId, brainId, sourceId]);
  }

  await client.query(ENQUEUE_SQL, [
    job.tenantId,
    brainId,
    JSON.stringify({ sourceId, brainId }),
    `compile:${sourceId}`,
  ]);
}
