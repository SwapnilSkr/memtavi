import { assertSafeKey } from "@memtavi/storage/keys";
import { type JobContext, JobError } from "./types";

export const RETENTION_BATCH_SIZE = 50;

export const RETENTION_CANDIDATES_SQL = `
  SELECT s.id, s.brain_id
  FROM ingest_sources s
  WHERE s.tenant_id = $1
    AND EXISTS (SELECT 1 FROM brains b WHERE b.tenant_id = $1
      AND b.id = s.brain_id AND b.deletion_state = 'active')
    AND (
      cardinality(s.body_delete_keys) > 0
      OR (
        s.body_dropped_at IS NULL AND s.status = 'completed'
        AND s.uncited_since < $2::timestamptz - interval '90 days'
        AND NOT EXISTS (SELECT 1 FROM page_sources ps
          WHERE ps.tenant_id = $1 AND ps.ingest_source_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.tenant_id = $1
          AND p.brain_id = s.brain_id AND p.id = ANY(s.affected_page_ids) AND p.pinned)
      )
    )
  ORDER BY s.uncited_since, s.id
  LIMIT $3
`;

type RetentionContext = Omit<JobContext, "client"> & { now?: () => Date };

export async function sweepRetention({
  job,
  store,
  withTenant,
  now = () => new Date(),
}: RetentionContext): Promise<void> {
  if (!withTenant) throw new JobError("permanent", "Tenant transactions are required");
  const at = now().toISOString();
  const candidates = await withTenant(job.tenantId, (client) =>
    client.query<{ id: string; brain_id: string }>(RETENTION_CANDIDATES_SQL, [
      job.tenantId,
      at,
      RETENTION_BATCH_SIZE,
    ]),
  );
  for (const candidate of candidates.rows) {
    const scope = [job.tenantId, candidate.brain_id, candidate.id];
    const keys = await withTenant(job.tenantId, async (client) => {
      const brain = await client.query(
        `SELECT id FROM brains WHERE tenant_id = $1 AND id = $2
         AND deletion_state = 'active' FOR SHARE`,
        scope.slice(0, 2),
      );
      if (!brain.rowCount) return [];
      const source = await client.query<{
        body_ref: string | null;
        metadata: unknown;
        body_dropped_at: Date | null;
        body_delete_keys: string[];
      }>(
        `SELECT body_ref, metadata, body_dropped_at, body_delete_keys FROM ingest_sources
         WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 FOR UPDATE`,
        scope,
      );
      const row = source.rows[0];
      if (!row) return [];
      if (row.body_dropped_at) return row.body_delete_keys;
      await client.query(
        `SELECT p.id FROM pages p JOIN ingest_sources s
           ON s.tenant_id = p.tenant_id AND s.brain_id = p.brain_id
         WHERE s.tenant_id = $1 AND s.brain_id = $2 AND s.id = $3
           AND p.id = ANY(s.affected_page_ids) FOR SHARE OF p`,
        scope,
      );
      const eligible = await client.query(
        `SELECT s.id FROM ingest_sources s
         WHERE s.tenant_id = $1 AND s.brain_id = $2 AND s.id = $3
           AND s.body_dropped_at IS NULL AND s.status = 'completed'
           AND s.uncited_since < $4::timestamptz - interval '90 days'
           AND NOT EXISTS (SELECT 1 FROM page_sources ps
             WHERE ps.tenant_id = $1 AND ps.ingest_source_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.tenant_id = $1
             AND p.brain_id = $2 AND p.id = ANY(s.affected_page_ids) AND p.pinned)`,
        [...scope, at],
      );
      if (!eligible.rowCount) return [];
      const chunks = await client.query<{ body_ref: string | null }>(
        `SELECT body_ref FROM source_chunks
         WHERE tenant_id = $1 AND brain_id = $2 AND source_id = $3`,
        scope,
      );
      const jobs = await client.query<{ payload: unknown }>(
        `SELECT payload FROM jobs
         WHERE tenant_id = $1 AND brain_id = $2 AND payload->>'sourceId' = $3`,
        scope,
      );
      const collected = new Set<string>();
      function collect(value: unknown): void {
        if (typeof value === "string") {
          const [prefix, tenantId, sourceId] = value.split("/", 3);
          if (
            tenantId === job.tenantId &&
            sourceId === candidate.id &&
            (prefix === "sources" || prefix === "originals" || prefix === "chunks")
          )
            collected.add(assertSafeKey(value));
        } else if (Array.isArray(value)) {
          for (const item of value) collect(item);
        } else if (value && typeof value === "object") {
          for (const item of Object.values(value)) collect(item);
        }
      }
      collect(row.body_ref);
      collect(row.metadata);
      collect(chunks.rows);
      collect(jobs.rows);
      if (!store.list) throw new JobError("permanent", "Retention requires object listing");
      for (const prefix of ["sources", "originals", "chunks"]) {
        collect(await store.list(`${prefix}/${job.tenantId}/${candidate.id}`));
      }
      const pending = [...collected].sort();
      await client.query(
        `UPDATE source_chunks SET text = NULL, body_ref = NULL
         WHERE tenant_id = $1 AND brain_id = $2 AND source_id = $3`,
        scope,
      );
      await client.query(
        `UPDATE idempotency_keys SET response_body = response_body ||
           '{"contentPreview":"","contentUrl":null}'::jsonb
         WHERE tenant_id = $1 AND scope = 'POST /v1/brains/' || $2 || '/captures'
           AND response_body->>'id' = $3`,
        scope,
      );
      await client.query(
        `UPDATE ingest_sources SET content = '', body_ref = NULL, body_bytes = 0,
           body_dropped_at = $4, body_delete_keys = $5::text[]
         WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
        [...scope, at, pending],
      );
      return pending;
    });
    for (const key of keys) {
      const [prefix, tenantId, sourceId] = key.split("/", 3);
      if (
        tenantId !== job.tenantId ||
        sourceId !== candidate.id ||
        (prefix !== "sources" && prefix !== "originals" && prefix !== "chunks")
      )
        throw new JobError("permanent", "Invalid retention object key");
      await store.delete(assertSafeKey(key));
    }
    if (keys.length) {
      await withTenant(job.tenantId, (client) =>
        client.query(
          `UPDATE ingest_sources SET body_delete_keys = '{}'::text[]
           WHERE tenant_id = $1 AND brain_id = $2 AND id = $3 AND body_dropped_at IS NOT NULL`,
          scope,
        ),
      );
    }
  }
  await withTenant(job.tenantId, async (client) => {
    const remaining = await client.query(RETENTION_CANDIDATES_SQL, [job.tenantId, at, 1]);
    const anchor = await client.query<{ id: string }>(
      `SELECT id FROM brains WHERE tenant_id = $1 AND deletion_state = 'active'
       ORDER BY id LIMIT 1 FOR SHARE`,
      [job.tenantId],
    );
    if (!anchor.rows[0]) return;
    await client.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, available_at)
       VALUES ($1, $2, 'retention.sweep', '{}', $3,
         now() + CASE WHEN $4::boolean THEN interval '0' ELSE interval '1 day' END)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
      [job.tenantId, anchor.rows[0].id, `retention:${job.id}`, Boolean(remaining.rowCount)],
    );
  });
}
