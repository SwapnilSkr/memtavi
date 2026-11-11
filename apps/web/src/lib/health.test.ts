import { expect, test } from "bun:test";
import { historyToPoints, scoreValue, suggestionRoute } from "./health";

test.each([
  { input: 86.4, expected: 86.4 },
  { input: 0, expected: 0 },
  { input: 100, expected: 100 },
  { input: 110, expected: 100 },
  { input: -2, expected: 0 },
  { input: Number.NaN, expected: null },
])("health value $input stays on the 0–100 scale", ({ input, expected }) => {
  expect(scoreValue(input)).toBe(expected);
});

test("history model orders UTC snapshots without mutating them or rescaling the metrics", () => {
  const points = [
    { computedAt: "2026-11-11T12:00:00Z", freshness: 93, readiness: 71, strain: 12 },
    { computedAt: "invalid", freshness: 20, readiness: 30, strain: 40 },
    { computedAt: "2026-11-10T12:00:00Z", freshness: 88, readiness: 65, strain: 20 },
  ];
  const result = historyToPoints({ points });
  expect(result).toHaveLength(2);
  expect(result[0]?.computedAt).toBe("2026-11-10T12:00:00Z");
  expect(result[1]?.freshness).toBe(93);
  expect(result[1]?.strain).toBe(12);
  expect(points[0]?.computedAt).toBe("2026-11-11T12:00:00Z");
  expect(historyToPoints({ points: [] })).toEqual([]);
});

test.each([
  ["retry_failed_sources", "capture"],
  ["resolve_contested_pages", "conflicts"],
  ["review_changes", "changes"],
  ["review_connections", "connections"],
  ["capture_input", "capture"],
  ["fill_profile", "profile"],
])("health action %s links to %s", (action, screen) => {
  expect(suggestionRoute("brn/a ?#", action)).toBe(`/brains/brn%2Fa%20%3F%23/${screen}`);
});

test.each(["unknown", "__proto__", "constructor"])(
  "unknown action %s has no misleading route",
  (action) => {
    expect(suggestionRoute("brn_a", action)).toBeNull();
  },
);
