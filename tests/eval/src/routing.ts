import type { RoutingEvent } from "../../../apps/worker/src/types";
import type { RoutingAggregate, RoutingBucket } from "./types";

interface BucketEdge {
  label: string;
  upperBound: number;
}

const BEST_BUCKETS: readonly BucketEdge[] = [
  { label: "<0.2", upperBound: 0.2 },
  { label: "0.2-0.4", upperBound: 0.4 },
  { label: "0.4-0.5", upperBound: 0.5 },
  { label: "0.5-0.6", upperBound: 0.6 },
  { label: "0.6-0.8", upperBound: 0.8 },
  { label: "0.8-1.0", upperBound: Number.POSITIVE_INFINITY },
];

const GAP_BUCKETS: readonly BucketEdge[] = [
  { label: "<0.05", upperBound: 0.05 },
  { label: "0.05-0.10", upperBound: 0.1 },
  { label: "0.10-0.15", upperBound: 0.15 },
  { label: ">=0.15", upperBound: Number.POSITIVE_INFINITY },
];

const GAP_MIN_BEST = 0.45;

const TOP_REVIEW_LIMIT = 5;

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function bucketCounts(value: readonly number[], edges: readonly BucketEdge[]): RoutingBucket[] {
  return edges.map((edge, index) => {
    const lower = index === 0 ? Number.NEGATIVE_INFINITY : (edges[index - 1]?.upperBound ?? 0);
    const count = value.filter((entry) => entry >= lower && entry < edge.upperBound).length;
    return { bucket: edge.label, count };
  });
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  const upper = sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? 0;
  return (lower + upper) / 2;
}

export function aggregateRouting(events: readonly RoutingEvent[]): RoutingAggregate {
  const actions = { place: 0, review: 0, new: 0 };
  for (const event of events) actions[event.action] += 1;

  const bestScores = events.map((event) => event.best);
  const gapped = events.filter((event) => event.best >= GAP_MIN_BEST).map((event) => event.gap);

  const topReviews = events
    .filter((event) => event.action === "review")
    .sort(
      (left, right) =>
        right.best - left.best ||
        left.gap - right.gap ||
        (left.factClaim < right.factClaim ? -1 : left.factClaim > right.factClaim ? 1 : 0),
    )
    .slice(0, TOP_REVIEW_LIMIT)
    .map((event) => ({
      claim: event.factClaim,
      best: round(event.best, 6),
      second: round(event.second, 6),
      gap: round(event.gap, 6),
      candidateCount: event.candidateCount,
    }));

  return {
    total: events.length,
    actions,
    bestBuckets: bucketCounts(bestScores, BEST_BUCKETS),
    gapBuckets: bucketCounts(gapped, GAP_BUCKETS),
    best: { mean: round(mean(bestScores), 6), median: round(median(bestScores), 6) },
    meanCandidateCount: round(mean(events.map((event) => event.candidateCount)), 2),
    topReviews,
  };
}
