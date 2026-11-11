import type { RoutingReviewDismiss, RoutingReviewResolve } from "./api";

export function reviewResolveBody(
  placement: string,
  note: string,
): RoutingReviewResolve | undefined {
  if (!placement) return undefined;
  const trimmed = note.trim();
  if (placement === "new") {
    return trimmed ? { newPage: true, note: trimmed } : { newPage: true };
  }
  return trimmed ? { pageId: placement, note: trimmed } : { pageId: placement };
}

export function reviewDismissBody(note: string): RoutingReviewDismiss | undefined {
  const trimmed = note.trim();
  return trimmed ? { note: trimmed } : undefined;
}
