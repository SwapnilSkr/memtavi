import { insertScoreSnapshot } from "@memtavi/db/health";
import type { PoolClient } from "pg";
import { requireBrain } from "./pages";

const scoreColumns = `brain_id AS "brainId", computed_at AS "computedAt",
  freshness, readiness, strain, factors`;

export async function getScore(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query(
    `SELECT ${scoreColumns} FROM score_snapshots
     WHERE tenant_id = $1 AND brain_id = $2
     ORDER BY computed_at DESC, id
     LIMIT 1`,
    [tenantId, brainId],
  );
  const score = result.rows[0];
  if (score) return score;
  return insertScoreSnapshot(client, tenantId, brainId);
}
