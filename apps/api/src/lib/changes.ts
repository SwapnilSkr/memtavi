import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import { requireBrain } from "./pages";

const changeColumns = `id, brain_id AS "brainId", page_id AS "pageId", action,
  change_summary AS "changeSummary", from_version AS "fromVersion", to_version AS "toVersion",
  ingest_source_id AS "ingestSourceId", contradictions, acked_at AS "ackedAt",
  created_at AS "createdAt"`;

export async function listChanges(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM change_events
     WHERE tenant_id = $1 AND brain_id = $2`,
    [tenantId, brainId],
  );
  const items = await client.query(
    `SELECT ${changeColumns} FROM change_events
     WHERE tenant_id = $1 AND brain_id = $2
     ORDER BY created_at DESC, id
     LIMIT $3 OFFSET $4`,
    [tenantId, brainId, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function ackChange(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  changeId: string,
  acked: boolean,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query(
    `UPDATE change_events
     SET acked_at = CASE WHEN $4 THEN COALESCE(acked_at, now()) ELSE NULL::timestamptz END
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
     RETURNING ${changeColumns}`,
    [tenantId, brainId, changeId, acked],
  );
  const change = result.rows[0];
  if (!change) throw new DomainError("NotFoundError", 404, "Not found");
  return change;
}
