import { describe, expect, test } from "bun:test";
import { computeHealth, HEALTH_WEIGHTS, type HealthMetrics } from "./compute";

const NOW = "2026-11-10T00:00:00.000Z";

function metrics(overrides: Partial<HealthMetrics> = {}): HealthMetrics {
  return {
    now: NOW,
    pageCount: 0,
    searchablePages: 0,
    contestedPages: 0,
    deprecatedPages: 0,
    failedSources: 0,
    backlogSources: 0,
    recentCaptures: 0,
    recentPageChanges: 0,
    unackedChanges: 0,
    unackedConnections: 0,
    profileFields: 0,
    lastCaptureAt: null,
    lastPageChangeAt: null,
    ...overrides,
  };
}

const healthy = metrics({
  pageCount: 40,
  searchablePages: 40,
  profileFields: HEALTH_WEIGHTS.profileFieldTotal,
  recentCaptures: 3,
  recentPageChanges: 5,
  lastCaptureAt: "2026-11-09T00:00:00.000Z",
  lastPageChangeAt: "2026-11-09T00:00:00.000Z",
});

const strained = metrics({
  pageCount: 4,
  searchablePages: 1,
  failedSources: 6,
  backlogSources: 5,
  contestedPages: 4,
  deprecatedPages: 3,
  unackedChanges: 8,
  unackedConnections: 8,
});

const TONE_CASES: {
  group: "freshness" | "readiness" | "strain";
  key: string;
  one: Partial<HealthMetrics>;
  tone: "positive" | "negative";
}[] = [
  { group: "freshness", key: "recent_captures", one: { recentCaptures: 1 }, tone: "positive" },
  {
    group: "freshness",
    key: "recent_page_changes",
    one: { recentPageChanges: 1 },
    tone: "positive",
  },
  { group: "readiness", key: "pages", one: { pageCount: 1 }, tone: "positive" },
  { group: "readiness", key: "searchable_pages", one: { searchablePages: 1 }, tone: "positive" },
  {
    group: "readiness",
    key: "profile_completeness",
    one: { profileFields: 1 },
    tone: "positive",
  },
  { group: "readiness", key: "failed_sources", one: { failedSources: 1 }, tone: "negative" },
  { group: "readiness", key: "contested_pages", one: { contestedPages: 1 }, tone: "negative" },
  { group: "strain", key: "failed_sources", one: { failedSources: 1 }, tone: "negative" },
  { group: "strain", key: "compile_backlog", one: { backlogSources: 1 }, tone: "negative" },
  { group: "strain", key: "contested_pages", one: { contestedPages: 1 }, tone: "negative" },
  { group: "strain", key: "deprecated_pages", one: { deprecatedPages: 1 }, tone: "negative" },
  { group: "strain", key: "unacked_changes", one: { unackedChanges: 1 }, tone: "negative" },
  {
    group: "strain",
    key: "unacked_connections",
    one: { unackedConnections: 1 },
    tone: "negative",
  },
];

describe("computeHealth", () => {
  test("an empty brain scores zero and reports neutral factors", () => {
    const score = computeHealth(metrics());
    expect(score.freshness).toBe(0);
    expect(score.readiness).toBe(0);
    expect(score.strain).toBe(0);
    expect(score.factors.freshness).toHaveLength(3);
    expect(score.factors.readiness).toHaveLength(5);
    expect(score.factors.strain).toHaveLength(6);
    expect(
      score.factors.freshness.find((factor) => factor.key === "days_since_input"),
    ).toMatchObject({
      value: HEALTH_WEIGHTS.freshnessDecayDays,
      tone: "negative",
    });
    const tones = [...score.factors.freshness, ...score.factors.readiness, ...score.factors.strain]
      .filter((factor) => factor.key !== "days_since_input")
      .map((factor) => factor.tone);
    expect(tones).toHaveLength(13);
    expect(tones.every((tone) => tone === "neutral")).toBe(true);
  });

  test.each(TONE_CASES)(
    "the $group factor $key is neutral at 0 and $tone at 1",
    ({ group, key, one, tone }) => {
      const empty = computeHealth(metrics()).factors[group].find((factor) => factor.key === key);
      expect(empty).toMatchObject({ value: 0, tone: "neutral" });
      const raised = computeHealth(metrics(one)).factors[group].find(
        (factor) => factor.key === key,
      );
      expect(raised).toMatchObject({ value: 1, tone });
    },
  );

  test("a healthy brain is fresh, ready and unstressed", () => {
    const score = computeHealth(healthy);
    expect(score).toMatchObject({ freshness: 100, readiness: 100, strain: 0 });
    const tones = new Map(score.factors.readiness.map((factor) => [factor.key, factor.tone]));
    expect(tones.get("pages")).toBe("positive");
    expect(tones.get("searchable_pages")).toBe("positive");
    expect(tones.get("profile_completeness")).toBe("positive");
    expect(tones.get("failed_sources")).toBe("neutral");
    expect(tones.get("contested_pages")).toBe("neutral");
  });

  test("a strained brain scores low readiness and high strain with negative factors", () => {
    const score = computeHealth(strained);
    expect(score.freshness).toBe(0);
    expect(score.readiness).toBe(0);
    expect(score.strain).toBe(100);
    expect(score.factors.readiness.find((factor) => factor.key === "failed_sources")).toMatchObject(
      {
        value: 6,
        tone: "negative",
      },
    );
    expect(score.factors.strain.find((factor) => factor.key === "failed_sources")).toMatchObject({
      value: 6,
      tone: "negative",
    });
  });

  test("the same input always produces the same output", () => {
    expect(computeHealth(strained)).toEqual(computeHealth({ ...strained }));
    expect(computeHealth(healthy)).toEqual(computeHealth({ ...healthy }));
  });

  test("recency inputs raise freshness and elapsed time lowers it", () => {
    const base = metrics({
      recentCaptures: 1,
      recentPageChanges: 1,
      lastCaptureAt: "2026-10-31T00:00:00.000Z",
    });
    const freshness = computeHealth(base).freshness;
    expect(computeHealth({ ...base, recentCaptures: 2 }).freshness).toBeGreaterThan(freshness);
    expect(computeHealth({ ...base, recentPageChanges: 3 }).freshness).toBeGreaterThan(freshness);
    expect(
      computeHealth({ ...base, lastCaptureAt: "2026-11-08T00:00:00.000Z" }).freshness,
    ).toBeGreaterThan(freshness);
    expect(
      computeHealth({ ...base, lastCaptureAt: "2026-09-01T00:00:00.000Z" }).freshness,
    ).toBeLessThan(freshness);
  });

  test("readiness rises with pages, searchable pages and profile fields", () => {
    const base = metrics({ pageCount: 3, searchablePages: 1, profileFields: 1 });
    const readiness = computeHealth(base).readiness;
    expect(computeHealth({ ...base, pageCount: 6 }).readiness).toBeGreaterThan(readiness);
    expect(computeHealth({ ...base, searchablePages: 3 }).readiness).toBeGreaterThan(readiness);
    expect(computeHealth({ ...base, profileFields: 3 }).readiness).toBeGreaterThan(readiness);
  });

  test("readiness falls with failed sources and contested pages", () => {
    const base = metrics({ pageCount: 10, searchablePages: 5, profileFields: 4 });
    const readiness = computeHealth(base).readiness;
    for (const override of [{ failedSources: 2 }, { contestedPages: 2 }]) {
      expect(computeHealth({ ...base, ...override }).readiness).toBeLessThan(readiness);
    }
  });

  test.each([
    { failedSources: 2 },
    { backlogSources: 2 },
    { contestedPages: 2 },
    { deprecatedPages: 2 },
    { unackedChanges: 2 },
    { unackedConnections: 2 },
  ])("strain rises with %j", (override) => {
    const base = metrics({ pageCount: 5 });
    expect(computeHealth({ ...base, ...override }).strain).toBeGreaterThan(
      computeHealth(base).strain,
    );
  });

  test("the formula clamps at both ends and rounds to one decimal", () => {
    const over = computeHealth({ ...healthy, recentCaptures: 100, recentPageChanges: 100 });
    expect(over.freshness).toBe(100);
    for (const value of [over.freshness, over.readiness, over.strain]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      expect(Number.isInteger(value * 10)).toBe(true);
    }
    const degraded = computeHealth({
      ...metrics(),
      pageCount: 1,
      failedSources: 1,
      lastCaptureAt: "2026-11-09T12:00:00.000Z",
    });
    expect(degraded.readiness).toBe(0);
    expect(degraded.freshness).toBeGreaterThan(0);
  });
});
