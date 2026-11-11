import { assertSafeKey } from "@memtavi/storage/keys";
import { type JobContext, JobError } from "./types";

interface PurgeDetail {
  keys: string[];
  counts: Record<string, number>;
}

export async function purgeBrain({ job, store, withTenant }: JobContext): Promise<void> {
  if (!withTenant) throw new JobError("permanent", "Brain purge is not configured");
  if (job.payload.brainId !== job.brainId) {
    throw new JobError("permanent", "Invalid job payload");
  }
  const scope = [job.tenantId, job.brainId];
  const prepared = await withTenant(job.tenantId, async (client) => {
    const brain = await client.query(
      `SELECT id FROM brains WHERE tenant_id = $1 AND id = $2
       AND deletion_state <> 'active' FOR UPDATE`,
      scope,
    );
    if (!brain.rowCount) return null;
    const operations = await client.query<{ id: string; state: string; detail: PurgeDetail }>(
      `SELECT id, state, detail FROM deletion_ops
       WHERE tenant_id = $1 AND brain_id = $2 AND target_type = 'brain' AND target_id = $2
       ORDER BY id LIMIT 1 FOR UPDATE`,
      scope,
    );
    const operation = operations.rows[0];
    if (!operation || operation.state === "completed") return null;
    if (operation.state === "purging") return operation;

    const sources = await client.query<{ id: string; body_ref: string | null; metadata: unknown }>(
      "SELECT id, body_ref, metadata FROM ingest_sources WHERE tenant_id = $1 AND brain_id = $2",
      scope,
    );
    const chunks = await client.query<{ body_ref: string | null }>(
      "SELECT body_ref FROM source_chunks WHERE tenant_id = $1 AND brain_id = $2",
      scope,
    );
    const jobs = await client.query<{ id: string; payload: unknown }>(
      "SELECT id, payload FROM jobs WHERE tenant_id = $1 AND brain_id = $2",
      scope,
    );
    const sourceIds = new Set(sources.rows.map(({ id }) => id));
    const keys = new Set<string>();
    function collect(value: unknown): void {
      if (typeof value === "string") {
        const [prefix, tenantId, targetId] = value.split("/", 3);
        if (tenantId !== job.tenantId || !targetId) return;
        if (
          (prefix === "exports" && targetId === job.brainId) ||
          ((prefix === "sources" || prefix === "chunks" || prefix === "originals") &&
            sourceIds.has(targetId))
        ) {
          keys.add(assertSafeKey(value));
        }
      } else if (Array.isArray(value)) {
        for (const item of value) collect(item);
      } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) collect(item);
      }
    }
    collect(sources.rows);
    collect(chunks.rows);
    collect(jobs.rows);
    const filters: Record<string, string> = {
      pages: "brain_id = $2",
      page_versions: "page_id IN (SELECT id FROM pages WHERE tenant_id = $1 AND brain_id = $2)",
      page_sources: "page_id IN (SELECT id FROM pages WHERE tenant_id = $1 AND brain_id = $2)",
      page_embeddings: "page_id IN (SELECT id FROM pages WHERE tenant_id = $1 AND brain_id = $2)",
      connections: "brain_id = $2",
      change_events: "brain_id = $2",
      webhook_deliveries:
        "event_id IN (SELECT id FROM webhook_events WHERE tenant_id = $1 AND brain_id = $2)",
      ingest_sources: "brain_id = $2",
      source_chunks: "brain_id = $2",
      routing_reviews: "brain_id = $2",
      profiles: "brain_id = $2",
      score_snapshots: "brain_id = $2",
      briefs: "brain_id = $2",
      jobs: "brain_id = $2",
      usage_ledger: "brain_id = $2",
      deletion_ops: "brain_id = $2 AND target_type <> 'brain'",
      idempotency_keys: "scope = 'POST /v1/brains/' || $2 || '/captures'",
    };
    const counts: Record<string, number> = {};
    for (const [table, filter] of Object.entries(filters)) {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1 AND ${filter}`,
        scope,
      );
      counts[table] = result.rows[0]?.count ?? 0;
    }
    for (const table of [
      "webhook_events",
      "pages",
      "ingest_sources",
      "profiles",
      "score_snapshots",
      "briefs",
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND brain_id = $2`, scope);
    }
    await client.query("DELETE FROM jobs WHERE tenant_id = $1 AND brain_id = $2 AND id <> $3", [
      ...scope,
      job.id,
    ]);
    await client.query("DELETE FROM usage_ledger WHERE tenant_id = $1 AND brain_id = $2", scope);
    await client.query(
      "DELETE FROM deletion_ops WHERE tenant_id = $1 AND brain_id = $2 AND id <> $3",
      [...scope, operation.id],
    );
    await client.query(
      `DELETE FROM idempotency_keys WHERE tenant_id = $1
       AND scope = 'POST /v1/brains/' || $2 || '/captures'`,
      scope,
    );
    const detail = { keys: [...keys].sort(), counts };
    await client.query(
      `UPDATE deletion_ops SET state = 'purging', detail = $3
       WHERE tenant_id = $1 AND id = $2`,
      [job.tenantId, operation.id, detail],
    );
    return { ...operation, detail };
  });
  if (!prepared) return;

  for (const key of prepared.detail.keys) await store.delete(key);

  await withTenant(job.tenantId, async (client) => {
    await client.query("SELECT id FROM brains WHERE tenant_id = $1 AND id = $2 FOR UPDATE", scope);
    await client.query(
      `UPDATE brains SET deletion_state = 'deleted', name = '', slug = '', description = '',
       brief_settings = '{}', project_id = NULL, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deletion_state = 'deleting'`,
      scope,
    );
    await client.query(
      `UPDATE deletion_ops SET state = 'completed', detail = $3
       WHERE tenant_id = $1 AND id = $2 AND state <> 'completed'`,
      [
        job.tenantId,
        prepared.id,
        { counts: prepared.detail.counts, objects: prepared.detail.keys.length },
      ],
    );
    await client.query("DELETE FROM jobs WHERE tenant_id = $1 AND brain_id = $2", scope);
  });
}
