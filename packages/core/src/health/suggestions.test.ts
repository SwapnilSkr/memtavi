import { describe, expect, test } from "bun:test";
import { computeHealth, type HealthMetrics } from "./compute";
import { buildSuggestions } from "./suggestions";

const NOW = "2026-11-10T00:00:00.000Z";

function metrics(overrides: Partial<HealthMetrics> = {}): HealthMetrics {
  return {
    now: NOW,
    pageCount: 40,
    searchablePages: 40,
    contestedPages: 0,
    deprecatedPages: 0,
    failedSources: 0,
    backlogSources: 0,
    recentCaptures: 3,
    recentPageChanges: 5,
    unackedChanges: 0,
    unackedConnections: 0,
    profileFields: 7,
    lastCaptureAt: "2026-11-09T00:00:00.000Z",
    lastPageChangeAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

function suggestions(overrides: Partial<HealthMetrics> = {}) {
  return buildSuggestions(computeHealth(metrics(overrides)).factors);
}

describe("buildSuggestions", () => {
  test("a healthy brain produces no suggestions", () => {
    expect(suggestions()).toEqual([]);
  });

  test("unknown or missing factors produce no suggestions", () => {
    expect(buildSuggestions(undefined)).toEqual([]);
    expect(buildSuggestions({})).toEqual([]);
    expect(buildSuggestions({ seeded: true })).toEqual([]);
    expect(buildSuggestions({ readiness: [{ key: "pages", value: 4 }] })).toEqual([]);
  });

  test("failed sources ask for a retry", () => {
    expect(suggestions({ failedSources: 6 })).toEqual([
      {
        key: "retry_failed_sources",
        title: "Retry failed sources",
        description:
          "6 failed sources need a retry. Retrying restores the knowledge that failed to compile.",
        action: "retry_failed_sources",
        actionLabel: "Retry sources",
        priority: "high",
      },
    ]);
  });

  test("contested pages ask for a resolution", () => {
    const items = suggestions({ contestedPages: 1 });
    expect(items).toEqual([
      {
        key: "resolve_contested_pages",
        title: "Resolve contested pages",
        description: "1 contested page needs a resolution.",
        action: "resolve_contested_pages",
        actionLabel: "Resolve pages",
        priority: "high",
      },
    ]);
  });

  test("unacknowledged changes ask for review", () => {
    expect(suggestions({ unackedChanges: 2 })).toEqual([
      {
        key: "review_unacked_changes",
        title: "Review unacknowledged changes",
        description: "2 unacknowledged changes need review.",
        action: "review_changes",
        actionLabel: "Review changes",
        priority: "medium",
      },
    ]);
  });

  test("unacknowledged connections ask for review", () => {
    expect(suggestions({ unackedConnections: 1 })).toEqual([
      {
        key: "review_unacked_connections",
        title: "Review unacknowledged connections",
        description: "1 unacknowledged connection needs review.",
        action: "review_connections",
        actionLabel: "Review connections",
        priority: "medium",
      },
    ]);
  });

  test("no recent capture asks for a capture", () => {
    const items = suggestions({ recentCaptures: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "capture_recent_input",
      action: "capture_input",
      actionLabel: "Capture input",
      priority: "medium",
    });
    expect(items[0]?.description).toContain("No capture completed in the last seven days.");
  });

  test("a thin profile asks to complete it", () => {
    expect(suggestions({ profileFields: 2 })).toEqual([
      {
        key: "fill_profile",
        title: "Complete the profile",
        description: "2 of 7 profile fields are filled. A complete profile steers compilation.",
        action: "fill_profile",
        actionLabel: "Fill profile",
        priority: "low",
      },
    ]);
  });

  test("a strained brain lists every rule in priority then key order", () => {
    const factors = computeHealth(
      metrics({
        pageCount: 4,
        searchablePages: 1,
        failedSources: 6,
        backlogSources: 5,
        contestedPages: 4,
        deprecatedPages: 3,
        recentCaptures: 0,
        unackedChanges: 8,
        unackedConnections: 8,
        profileFields: 0,
      }),
    ).factors;
    const items = buildSuggestions(factors);
    expect(items.map((item) => item.key)).toEqual([
      "resolve_contested_pages",
      "retry_failed_sources",
      "capture_recent_input",
      "review_unacked_changes",
      "review_unacked_connections",
      "fill_profile",
    ]);
    expect(items.map((item) => item.priority)).toEqual([
      "high",
      "high",
      "medium",
      "medium",
      "medium",
      "low",
    ]);
  });

  test("the same factors always produce the same suggestions", () => {
    const factors = computeHealth(metrics({ failedSources: 2, contestedPages: 3 })).factors;
    expect(buildSuggestions(factors)).toEqual(buildSuggestions(structuredClone(factors)));
  });
});
