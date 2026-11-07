import type { RouteDecision } from "../schemas";

export const PFS_MIN_SCORE = 0.45;
export const PFS_PLACE_GAP = 0.15;
export const PFS_TIE_BREAK =
  "Score descending, oldest createdAt first, slug ascending, id ascending.";

export interface PageCandidate {
  id: string;
  slug: string;
  createdAt: string;
  score: number;
}

export function decidePfs(candidates: readonly PageCandidate[]): RouteDecision {
  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.score) ||
      candidate.score < 0 ||
      candidate.score > 1 ||
      !Number.isFinite(Date.parse(candidate.createdAt))
    ) {
      throw new RangeError("Invalid routing candidate");
    }
  }
  const ordered = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const first = ordered[0];
  const best = first?.score ?? 0;
  const second = ordered[1]?.score ?? 0;
  const gap = Number((best - second).toFixed(15));
  const scores = { best, second, gap };
  if (first === undefined || best < PFS_MIN_SCORE) return { action: "new", ...scores };
  if (gap >= PFS_PLACE_GAP) return { action: "place", pageId: first.id, ...scores };
  return {
    action: "review",
    candidateIds: ordered
      .filter((candidate) => Number((best - candidate.score).toFixed(15)) < PFS_PLACE_GAP)
      .map((candidate) => candidate.id),
    ...scores,
  };
}
