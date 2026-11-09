import type { PoolClient } from "pg";
import { JobError } from "./types";

const SPEND_SQL = `
  SELECT COALESCE(SUM(cost_usd), 0)::numeric(18, 8) AS spend
  FROM usage_ledger
  WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())
`;

const CAP_SQL = `
  SELECT monthly_usd AS "monthlyUsd", hard_stop AS "hardStop"
  FROM budget_caps
  WHERE tenant_id = $1
`;

const REFRESH_SQL = `
  UPDATE budget_caps SET current_period_spend = $2 WHERE tenant_id = $1
`;

export async function assertBudget(client: PoolClient, tenantId: string): Promise<void> {
  const cap = (await client.query<{ monthlyUsd: string; hardStop: boolean }>(CAP_SQL, [tenantId]))
    .rows[0];
  if (!cap) return;
  const spend = Number(
    (await client.query<{ spend: string }>(SPEND_SQL, [tenantId])).rows[0]?.spend ?? 0,
  );
  const capUsd = Number(cap.monthlyUsd);
  if (cap.hardStop && spend >= capUsd) {
    throw new JobError(
      "permanent",
      `Monthly budget cap reached: spent $${spend.toFixed(8)} of $${capUsd.toFixed(8)}`,
    );
  }
  // Bookkeeping is advisory: a failed refresh must not poison the compile transaction.
  try {
    await client.query("SAVEPOINT budget_cap_refresh");
    await client.query(REFRESH_SQL, [tenantId, spend]);
    await client.query("RELEASE SAVEPOINT budget_cap_refresh");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT budget_cap_refresh");
  }
}
