import { HEALTH_WEIGHTS, type HealthFactor } from "./compute";

export type SuggestionPriority = "high" | "medium" | "low";

export interface ScoreSuggestion {
  key: string;
  title: string;
  description: string;
  action: string;
  actionLabel: string;
  priority: SuggestionPriority;
}

const PRIORITY_RANK: Record<SuggestionPriority, number> = { high: 0, medium: 1, low: 2 };
const FACTOR_GROUPS = ["freshness", "readiness", "strain"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFactor(value: unknown): value is HealthFactor {
  return isRecord(value) && typeof value.key === "string" && typeof value.value === "number";
}

function factorValue(factors: unknown, key: string): number | null {
  if (!isRecord(factors)) return null;
  for (const group of FACTOR_GROUPS) {
    const list = factors[group];
    if (!Array.isArray(list)) continue;
    for (const factor of list) {
      if (isFactor(factor) && factor.key === key) return factor.value;
    }
  }
  return null;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

interface Rule {
  factor: string;
  key: string;
  title: string;
  action: string;
  actionLabel: string;
  priority: SuggestionPriority;
  applies(value: number): boolean;
  describe(value: number): string;
}

const RULES: readonly Rule[] = [
  {
    factor: "contested_pages",
    key: "resolve_contested_pages",
    title: "Resolve contested pages",
    action: "resolve_contested_pages",
    actionLabel: "Resolve pages",
    priority: "high",
    applies: (value) => value > 0,
    describe: (value) =>
      `${plural(value, "contested page")} ${value === 1 ? "needs" : "need"} a resolution.`,
  },
  {
    factor: "failed_sources",
    key: "retry_failed_sources",
    title: "Retry failed sources",
    action: "retry_failed_sources",
    actionLabel: "Retry sources",
    priority: "high",
    applies: (value) => value > 0,
    describe: (value) =>
      `${plural(value, "failed source")} ${
        value === 1 ? "needs" : "need"
      } a retry. Retrying restores the knowledge that failed to compile.`,
  },
  {
    factor: "recent_captures",
    key: "capture_recent_input",
    title: "Capture recent input",
    action: "capture_input",
    actionLabel: "Capture input",
    priority: "medium",
    applies: (value) => value === 0,
    describe: () =>
      "No capture completed in the last seven days. Add new material to keep the brain current.",
  },
  {
    factor: "unacked_changes",
    key: "review_unacked_changes",
    title: "Review unacknowledged changes",
    action: "review_changes",
    actionLabel: "Review changes",
    priority: "medium",
    applies: (value) => value > 0,
    describe: (value) =>
      `${plural(value, "unacknowledged change")} ${value === 1 ? "needs" : "need"} review.`,
  },
  {
    factor: "unacked_connections",
    key: "review_unacked_connections",
    title: "Review unacknowledged connections",
    action: "review_connections",
    actionLabel: "Review connections",
    priority: "medium",
    applies: (value) => value > 0,
    describe: (value) =>
      `${plural(value, "unacknowledged connection")} ${value === 1 ? "needs" : "need"} review.`,
  },
  {
    factor: "profile_completeness",
    key: "fill_profile",
    title: "Complete the profile",
    action: "fill_profile",
    actionLabel: "Fill profile",
    priority: "low",
    applies: (value) => value < HEALTH_WEIGHTS.profileFieldTotal,
    describe: (value) =>
      `${value} of ${HEALTH_WEIGHTS.profileFieldTotal} profile fields ${
        value === 1 ? "is" : "are"
      } filled. A complete profile steers compilation.`,
  },
];

export function buildSuggestions(factors: unknown): ScoreSuggestion[] {
  const suggestions: ScoreSuggestion[] = [];
  for (const rule of RULES) {
    const value = factorValue(factors, rule.factor);
    if (value === null || !rule.applies(value)) continue;
    suggestions.push({
      key: rule.key,
      title: rule.title,
      description: rule.describe(value),
      action: rule.action,
      actionLabel: rule.actionLabel,
      priority: rule.priority,
    });
  }
  return suggestions.sort(
    (left, right) =>
      PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || compare(left.key, right.key),
  );
}
