export interface BudgetCap {
  monthlyUsd: number;
  hardStop: boolean;
}

export function budgetExceeded(
  cap: BudgetCap | undefined,
  spendUsd: number,
  estimatedUsd = 0,
): boolean {
  return Boolean(
    cap?.hardStop && (spendUsd >= cap.monthlyUsd || spendUsd + estimatedUsd > cap.monthlyUsd),
  );
}
