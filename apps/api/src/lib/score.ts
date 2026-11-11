import { buildSuggestions } from "@memtavi/core/health/suggestions";
import { insertScoreSnapshot } from "@memtavi/db/health";
import type { PoolClient } from "pg";
import { requireBrain } from "./pages";

const DAY_MS = 86_400_000;

export const HISTORY_RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type HistoryRange = keyof typeof HISTORY_RANGE_DAYS;

export interface ScoreRow {
  brainId: string;
  computedAt: Date;
  freshness: number;
  readiness: number;
  strain: number;
  factors: unknown;
}

interface HistoryRow {
  computedAt: Date;
  freshness: number;
  readiness: number;
  strain: number;
}

const scoreColumns = `brain_id AS "brainId", computed_at AS "computedAt",
  freshness, readiness, strain, factors`;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function getScore(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
): Promise<ScoreRow> {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query<ScoreRow>(
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

export async function getScoreHistory(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  range: HistoryRange,
  now: Date,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const since = new Date(now.getTime() - HISTORY_RANGE_DAYS[range] * DAY_MS);
  const result = await client.query<HistoryRow>(
    `SELECT DISTINCT ON (date_trunc('day', computed_at AT TIME ZONE 'UTC'))
       computed_at AS "computedAt", freshness, readiness, strain
     FROM score_snapshots
     WHERE tenant_id = $1 AND brain_id = $2 AND computed_at >= $3
     ORDER BY date_trunc('day', computed_at AT TIME ZONE 'UTC') ASC, computed_at DESC, id`,
    [tenantId, brainId, since.toISOString()],
  );
  const points = result.rows.map((row) => ({
    computedAt: row.computedAt.toISOString(),
    freshness: row.freshness,
    readiness: row.readiness,
    strain: row.strain,
  }));
  const first = points[0];
  const last = points[points.length - 1];
  return {
    range,
    points,
    delta:
      first === undefined || last === undefined || points.length < 2
        ? null
        : {
            freshness: round1(last.freshness - first.freshness),
            readiness: round1(last.readiness - first.readiness),
            strain: round1(last.strain - first.strain),
          },
  };
}

export async function getScoreSuggestions(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
) {
  const score = await getScore(client, tenantId, subjectId, brainId);
  return {
    generatedBy: "rules" as const,
    basedOn: score.computedAt,
    items: buildSuggestions(score.factors),
  };
}
