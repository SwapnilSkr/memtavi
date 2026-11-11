import { expect, test } from "bun:test";
import {
  type CacheEffect,
  type CacheMutation,
  type CacheScope,
  captureSettledEffect,
  queryEffect,
} from "./invalidation";

const brain = { brainId: "brn_a", slug: "topic", sourceId: "src_a" };

test.each<{
  mutation: CacheMutation;
  queryKey: readonly unknown[];
  scope: CacheScope;
  effect: CacheEffect;
}>([
  {
    mutation: "updateBrain",
    queryKey: ["brains", null, { limit: 50, offset: 0 }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updateBrain",
    queryKey: ["brain", "brn_a", {}],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updateBrain",
    queryKey: ["brain", "brn_b", {}],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "updateBrain",
    queryKey: ["pages", "brn_a", {}],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "deleteBrain",
    queryKey: ["brains", null, {}],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "deleteBrain",
    queryKey: ["pages", "brn_a", { limit: 50 }],
    scope: brain,
    effect: "drop",
  },
  {
    mutation: "deleteBrain",
    queryKey: ["page", "brn_a", { slug: "topic" }],
    scope: brain,
    effect: "drop",
  },
  {
    mutation: "deleteBrain",
    queryKey: ["pages", "brn_b", {}],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "createCapture",
    queryKey: ["sources", "brn_a", { limit: 50, offset: 0 }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "createCapture",
    queryKey: ["pages", "brn_a", {}],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "retryIngestSource",
    queryKey: ["sources", "brn_a", { offset: 0 }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "retryIngestSource",
    queryKey: ["source", "brn_a", { sourceId: "src_a" }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "approveIngestSource",
    queryKey: ["source", "brn_a", { sourceId: "src_b" }],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "updatePage",
    queryKey: ["pages", "brn_a", { status: "contested" }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["search", "brn_a", { q: "topic" }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["graph", "brn_a", {}],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["changes", "brn_a", { limit: 50 }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["index", "brn_a", { limit: 50, offset: 250, status: "contested" }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["page-versions", "brn_a", { slug: "topic" }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["page-version", "brn_a", { slug: "topic", version: 2 }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["page-diff", "brn_a", { slug: "topic", from: 1, to: 2 }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "updatePage",
    queryKey: ["page-versions", "brn_a", { slug: "other" }],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "updatePage",
    queryKey: ["page", "brn_a", { slug: "topic" }],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "resolvePage",
    queryKey: ["pages", "brn_a", { status: "contested", offset: 0 }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "resolvePage",
    queryKey: ["page", "brn_a", { slug: "topic" }],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "resolvePage",
    queryKey: ["connections", "brn_a", {}],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "deletePage",
    queryKey: ["pages", "brn_a", {}],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "deletePage",
    queryKey: ["connections", "brn_a", {}],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "deletePage",
    queryKey: ["page", "brn_a", { slug: "topic" }],
    scope: brain,
    effect: "drop",
  },
  {
    mutation: "deletePage",
    queryKey: ["page-diff", "brn_a", { slug: "topic", from: 1, to: 2 }],
    scope: brain,
    effect: "drop",
  },
  {
    mutation: "deletePage",
    queryKey: ["page", "brn_a", { slug: "other" }],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "resolveRoutingReview",
    queryKey: ["routing-reviews", "brn_a", { status: "open" }],
    scope: brain,
    effect: "invalidate",
  },
  {
    mutation: "resolveRoutingReview",
    queryKey: ["pages", "brn_a", {}],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "dismissRoutingReview",
    queryKey: ["routing-reviews", "brn_b", { status: "open" }],
    scope: brain,
    effect: "keep",
  },
  {
    mutation: "updatePage",
    queryKey: [1, "brn_a"],
    scope: brain,
    effect: "keep",
  },
])("$mutation on $queryKey is $effect", ({ mutation, queryKey, scope, effect }) => {
  expect(queryEffect(mutation, queryKey, scope)).toBe(effect);
});

test("a settled capture refreshes brain lists and only the affected page", () => {
  const scope = { brainId: "brn_a", affectedPageIds: ["pg_1"] };
  expect(captureSettledEffect(["pages", "brn_a", {}], "pg_1", scope)).toBe(true);
  expect(
    captureSettledEffect(["routing-reviews", "brn_a", { status: "open" }], undefined, scope),
  ).toBe(true);
  expect(captureSettledEffect(["page", "brn_a", { slug: "topic" }], "pg_1", scope)).toBe(true);
  expect(captureSettledEffect(["page", "brn_a", { slug: "other" }], "pg_2", scope)).toBe(false);
  expect(captureSettledEffect(["pages", "brn_b", {}], "pg_1", scope)).toBe(false);
  expect(captureSettledEffect(["profile", "brn_a", {}], undefined, scope)).toBe(false);
});

test.each(["updatePage", "resolvePage", "deletePage"] as const)(
  "%s refreshes all paged index filters for only the affected brain",
  (mutation) => {
    expect(
      queryEffect(
        mutation,
        ["index", "brn_b", { limit: 50, offset: 250, status: "contested" }],
        brain,
      ),
    ).toBe("keep");
    for (const params of [
      { limit: 50, offset: 0 },
      { limit: 50, offset: 250, status: "contested" },
    ]) {
      expect(queryEffect(mutation, ["index", "brn_a", params], brain)).toBe("invalidate");
    }
  },
);
