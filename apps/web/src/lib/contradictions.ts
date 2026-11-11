export interface ClaimPair {
  existingClaim: string;
  newClaim: string;
  quote?: string;
}

export interface ContradictionEvent {
  pageId: string;
  createdAt: string;
  contradictions: readonly unknown[];
}

export function latestContradiction<T extends ContradictionEvent>(
  events: readonly T[],
  pageId: string,
): T | undefined {
  const matches = events.filter(
    (event) => event.pageId === pageId && event.contradictions.length > 0,
  );
  matches.sort((left, right) => {
    if (left.createdAt === right.createdAt) return 0;
    return left.createdAt < right.createdAt ? 1 : -1;
  });
  return matches[0];
}

function claimText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readClaims(contradictions: readonly unknown[]): ClaimPair[] {
  const pairs: ClaimPair[] = [];
  for (const item of contradictions) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const existingClaim = claimText(record.existingClaim);
    const newClaim = claimText(record.newClaim);
    if (!existingClaim || !newClaim) continue;
    const evidence = record.evidence;
    const quote =
      evidence && typeof evidence === "object"
        ? claimText((evidence as Record<string, unknown>).quote)
        : undefined;
    pairs.push(
      quote === undefined ? { existingClaim, newClaim } : { existingClaim, newClaim, quote },
    );
  }
  return pairs;
}
