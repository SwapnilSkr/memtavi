import type { ScoreHistory, ScorePoint } from "./api";

export const healthMetrics = ["freshness", "readiness", "strain"] as const;

export function scoreValue(value: number): number | null {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

export function historyToPoints(history: Pick<ScoreHistory, "points">): ScorePoint[] {
  return history.points
    .filter((point) => Number.isFinite(Date.parse(point.computedAt)))
    .map((point) => ({ ...point }))
    .sort((a, b) => Date.parse(a.computedAt) - Date.parse(b.computedAt));
}

export function suggestionRoute(brainId: string, action: string): string | null {
  const routes: Record<string, string> = {
    retry_failed_sources: "capture",
    resolve_contested_pages: "conflicts",
    review_changes: "changes",
    review_connections: "connections",
    capture_input: "capture",
    fill_profile: "profile",
  };
  const screen = Object.hasOwn(routes, action) ? routes[action] : undefined;
  return screen ? `/brains/${encodeURIComponent(brainId)}/${screen}` : null;
}
