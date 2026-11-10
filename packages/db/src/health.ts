import { computeHealth, type HealthMetrics, type HealthScore } from "@memtavi/core/health/compute";
import type { PoolClient } from "pg";

interface MetricsRow {
  now: Date;
  pageCount: number;
  searchablePages: number;
  contestedPages: number;
  deprecatedPages: number;
  failedSources: number;
  backlogSources: number;
  recentCaptures: number;
  recentPageChanges: number;
  unackedChanges: number;
  unackedConnections: number;
  profileFields: number;
  lastCaptureAt: Date | null;
  lastPageChangeAt: Date | null;
}

export interface ScoreSnapshotRow {
  brainId: string;
  computedAt: Date;
  freshness: number;
  readiness: number;
  strain: number;
  factors: HealthScore["factors"];
}

export const HEALTH_METRICS_SQL = `
  SELECT
    now() AS "now",
    (SELECT count(*)::int FROM pages p
      WHERE p.tenant_id = $1 AND p.brain_id = $2 AND p.deletion_state = 'active') AS "pageCount",
    (SELECT count(DISTINCT p.id)::int FROM pages p
      JOIN page_embeddings e ON e.tenant_id = p.tenant_id AND e.page_id = p.id
      WHERE p.tenant_id = $1 AND p.brain_id = $2 AND p.deletion_state = 'active'
        AND p.status = 'active') AS "searchablePages",
    (SELECT count(*)::int FROM pages p
      WHERE p.tenant_id = $1 AND p.brain_id = $2 AND p.deletion_state = 'active'
        AND p.status = 'contested') AS "contestedPages",
    (SELECT count(*)::int FROM pages p
      WHERE p.tenant_id = $1 AND p.brain_id = $2 AND p.deletion_state = 'active'
        AND p.status = 'deprecated') AS "deprecatedPages",
    (SELECT count(*)::int FROM ingest_sources s
      WHERE s.tenant_id = $1 AND s.brain_id = $2 AND s.deleted_at IS NULL
        AND s.status = 'failed') AS "failedSources",
    (SELECT count(*)::int FROM ingest_sources s
      WHERE s.tenant_id = $1 AND s.brain_id = $2 AND s.deleted_at IS NULL
        AND s.status IN ('pending', 'compiling')) AS "backlogSources",
    (SELECT count(*)::int FROM ingest_sources s
      WHERE s.tenant_id = $1 AND s.brain_id = $2 AND s.deleted_at IS NULL
        AND s.status = 'completed' AND s.compiled_at >= now() - interval '7 days')
      AS "recentCaptures",
    (SELECT count(*)::int FROM change_events c
      WHERE c.tenant_id = $1 AND c.brain_id = $2
        AND c.created_at >= now() - interval '7 days') AS "recentPageChanges",
    (SELECT count(*)::int FROM change_events c
      WHERE c.tenant_id = $1 AND c.brain_id = $2 AND c.acked_at IS NULL) AS "unackedChanges",
    (SELECT count(*)::int FROM connections c
      WHERE c.tenant_id = $1 AND c.brain_id = $2 AND c.acked_at IS NULL) AS "unackedConnections",
    (SELECT count(*)::int FROM profiles pr,
      LATERAL (VALUES (pr.who_they_are), (pr.what_they_do), (pr.focus), (pr.goals),
        (pr.current_projects), (pr.stuck_on), (pr.vault_organization)) AS field(value)
      WHERE pr.tenant_id = $1 AND pr.brain_id = $2 AND field.value <> '') AS "profileFields",
    (SELECT max(s.compiled_at) FROM ingest_sources s
      WHERE s.tenant_id = $1 AND s.brain_id = $2 AND s.deleted_at IS NULL) AS "lastCaptureAt",
    (SELECT max(c.created_at) FROM change_events c
      WHERE c.tenant_id = $1 AND c.brain_id = $2) AS "lastPageChangeAt"
`;

export const ENQUEUE_SNAPSHOT_SQL = `
  INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
  SELECT b.tenant_id, b.id, 'score.snapshot',
    jsonb_build_object('brainId', b.id),
    'score:' || b.id || ':' || (floor(extract(epoch FROM now()) / 60))::bigint::text,
    5
  FROM brains b
  WHERE b.tenant_id = $1 AND b.id = $2 AND b.deletion_state = 'active'
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
`;

export const INSERT_SNAPSHOT_SQL = `
  INSERT INTO score_snapshots (tenant_id, brain_id, freshness, readiness, strain, factors)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb)
  RETURNING brain_id AS "brainId", computed_at AS "computedAt", freshness, readiness, strain, factors
`;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export async function collectHealthMetrics(
  client: PoolClient,
  tenantId: string,
  brainId: string,
): Promise<HealthMetrics> {
  const result = await client.query<MetricsRow>(HEALTH_METRICS_SQL, [tenantId, brainId]);
  const row = result.rows[0];
  if (!row) throw new Error("Health metrics unavailable");
  return {
    now: row.now.toISOString(),
    pageCount: row.pageCount,
    searchablePages: row.searchablePages,
    contestedPages: row.contestedPages,
    deprecatedPages: row.deprecatedPages,
    failedSources: row.failedSources,
    backlogSources: row.backlogSources,
    recentCaptures: row.recentCaptures,
    recentPageChanges: row.recentPageChanges,
    unackedChanges: row.unackedChanges,
    unackedConnections: row.unackedConnections,
    profileFields: row.profileFields,
    lastCaptureAt: iso(row.lastCaptureAt),
    lastPageChangeAt: iso(row.lastPageChangeAt),
  };
}

export async function insertScoreSnapshot(
  client: PoolClient,
  tenantId: string,
  brainId: string,
): Promise<ScoreSnapshotRow> {
  const score = computeHealth(await collectHealthMetrics(client, tenantId, brainId));
  const result = await client.query<ScoreSnapshotRow>(INSERT_SNAPSHOT_SQL, [
    tenantId,
    brainId,
    score.freshness,
    score.readiness,
    score.strain,
    JSON.stringify(score.factors),
  ]);
  const row = result.rows[0];
  if (!row) throw new Error("Snapshot write failed");
  return row;
}

export async function enqueueScoreSnapshot(
  client: PoolClient,
  tenantId: string,
  brainId: string,
): Promise<void> {
  await client.query(ENQUEUE_SNAPSHOT_SQL, [tenantId, brainId]);
}
