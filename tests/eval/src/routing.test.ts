import { describe, expect, test } from "bun:test";
import type { RoutingEvent } from "../../../apps/worker/src/types";
import { aggregateRouting } from "./routing";

function event(
  overrides: Partial<RoutingEvent> & Pick<RoutingEvent, "action" | "best">,
): RoutingEvent {
  return {
    sourceId: "src_test",
    factClaim: "A claim",
    second: 0,
    gap: overrides.best,
    candidateCount: 3,
    candidateIds: ["pg_a", "pg_b", "pg_c"],
    ...overrides,
  };
}

describe("aggregateRouting", () => {
  test("returns zeroed aggregates for an empty input", () => {
    const aggregate = aggregateRouting([]);
    expect(aggregate.total).toBe(0);
    expect(aggregate.actions).toEqual({ place: 0, review: 0, new: 0 });
    expect(aggregate.best).toEqual({ mean: 0, median: 0 });
    expect(aggregate.meanCandidateCount).toBe(0);
    expect(aggregate.topReviews).toEqual([]);
    expect(aggregate.bestBuckets.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(aggregate.gapBuckets.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0]);
  });

  test("counts each action", () => {
    const aggregate = aggregateRouting([
      event({ action: "place", best: 0.9 }),
      event({ action: "review", best: 0.5 }),
      event({ action: "review", best: 0.7 }),
      event({ action: "new", best: 0.1 }),
    ]);
    expect(aggregate.total).toBe(4);
    expect(aggregate.actions).toEqual({ place: 1, review: 2, new: 1 });
  });

  test("places boundary scores in the higher bucket", () => {
    const aggregate = aggregateRouting([
      event({ action: "new", best: 0 }),
      event({ action: "new", best: 0.2 }),
      event({ action: "new", best: 0.4 }),
      event({ action: "place", best: 0.5 }),
      event({ action: "place", best: 0.6 }),
      event({ action: "place", best: 0.8 }),
      event({ action: "place", best: 1 }),
    ]);
    expect(aggregate.bestBuckets).toEqual([
      { bucket: "<0.2", count: 1 },
      { bucket: "0.2-0.4", count: 1 },
      { bucket: "0.4-0.5", count: 1 },
      { bucket: "0.5-0.6", count: 1 },
      { bucket: "0.6-0.8", count: 1 },
      { bucket: "0.8-1.0", count: 2 },
    ]);
  });

  test("rounds gap scores at 0.15 into the top gap bucket", () => {
    const aggregate = aggregateRouting([
      event({ action: "review", best: 0.5, second: 0.45, gap: 0.05 }),
      event({ action: "review", best: 0.5, second: 0.42, gap: 0.08 }),
      event({ action: "review", best: 0.5, second: 0.38, gap: 0.12 }),
      event({ action: "place", best: 0.5, second: 0.35, gap: 0.15 }),
    ]);
    expect(aggregate.gapBuckets).toEqual([
      { bucket: "<0.05", count: 0 },
      { bucket: "0.05-0.10", count: 2 },
      { bucket: "0.10-0.15", count: 1 },
      { bucket: ">=0.15", count: 1 },
    ]);
  });

  test("excludes facts below 0.45 from gap buckets", () => {
    const aggregate = aggregateRouting([
      event({ action: "new", best: 0.44, second: 0.4, gap: 0.04 }),
      event({ action: "place", best: 0.45, second: 0.1, gap: 0.35 }),
    ]);
    const gapped = aggregate.gapBuckets.reduce((total, bucket) => total + bucket.count, 0);
    expect(gapped).toBe(1);
    expect(aggregate.gapBuckets.at(-1)).toEqual({ bucket: ">=0.15", count: 1 });
  });

  test("computes the median of an odd number of scores", () => {
    const aggregate = aggregateRouting([
      event({ action: "new", best: 0.1 }),
      event({ action: "place", best: 0.9 }),
      event({ action: "review", best: 0.5 }),
      event({ action: "new", best: 0.3 }),
      event({ action: "place", best: 0.7 }),
    ]);
    expect(aggregate.best.median).toBe(0.5);
  });

  test("averages the two middle scores for an even count", () => {
    const aggregate = aggregateRouting([
      event({ action: "new", best: 0.1 }),
      event({ action: "review", best: 0.4 }),
      event({ action: "review", best: 0.6 }),
      event({ action: "place", best: 0.9 }),
    ]);
    expect(aggregate.best.median).toBe(0.5);
    expect(aggregate.best.mean).toBeCloseTo(0.5, 6);
  });

  test("breaks ties by the lower gap and then the claim", () => {
    const aggregate = aggregateRouting([
      event({ action: "review", best: 0.5, second: 0.4, gap: 0.1, factClaim: "zeta" }),
      event({ action: "review", best: 0.5, second: 0.42, gap: 0.08, factClaim: "beta" }),
      event({ action: "review", best: 0.5, second: 0.42, gap: 0.08, factClaim: "alpha" }),
    ]);
    expect(aggregate.topReviews.map((review) => review.claim)).toEqual(["alpha", "beta", "zeta"]);
  });

  test("keeps only the five highest-scoring reviews and excludes other actions", () => {
    const aggregate = aggregateRouting([
      event({ action: "place", best: 1, factClaim: "placed-high" }),
      ...[0.5, 0.51, 0.52, 0.53, 0.54, 0.55].map((best) =>
        event({ action: "review", best, second: best - 0.01, gap: 0.01 }),
      ),
    ]);
    expect(aggregate.topReviews).toHaveLength(5);
    expect(aggregate.topReviews.map((review) => review.best)).toEqual([
      0.55, 0.54, 0.53, 0.52, 0.51,
    ]);
  });

  test("reports the mean candidate count", () => {
    const aggregate = aggregateRouting([
      event({ action: "new", best: 0.1, candidateCount: 0 }),
      event({ action: "place", best: 0.9, candidateCount: 5 }),
      event({ action: "review", best: 0.5, candidateCount: 2 }),
    ]);
    expect(aggregate.meanCandidateCount).toBe(2.33);
  });
});
