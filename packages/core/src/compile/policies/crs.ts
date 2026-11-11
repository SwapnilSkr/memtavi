export const CONNECTION_CANDIDATE_COUNT = 8;
export const CONNECTION_SIMILARITY_FLOOR = 0.45;

export type ConnectionStrength = "weak" | "medium" | "strong";

const strengthRank = { weak: 0, medium: 1, strong: 2 } as const;

export function canonicalPair(left: string, right: string): [string, string] {
  if (!left || !right || left === right) throw new Error("Distinct page ids are required");
  return left < right ? [left, right] : [right, left];
}

export function isConnectionCandidate(similarity: number): boolean {
  return (
    Number.isFinite(similarity) && similarity >= CONNECTION_SIMILARITY_FLOOR && similarity <= 1
  );
}

export function strengthRose(previous: ConnectionStrength, next: ConnectionStrength): boolean {
  return strengthRank[next] > strengthRank[previous];
}
