import { describe, expect, test } from "bun:test";
import { relativeTime, resolvePage, versionTransition } from "./activity";

describe("version transitions", () => {
  test.each([
    [null, 1, "null → 1"],
    [1, 2, "1 → 2"],
    [12, 15, "12 → 15"],
    [0, 1, "0 → 1"],
  ] as const)("formats %s to %s", (from, to, expected) => {
    expect(versionTransition(from, to)).toBe(expected);
  });
});

describe("page ID resolution", () => {
  const pages = [
    { id: "pg_first", slug: "first-page" },
    { id: "pg_second", slug: "second/page" },
  ];

  test("finds a page slug by ID rather than by list position", () => {
    expect(resolvePage(pages, "pg_second")?.slug).toBe("second/page");
  });

  test("a missing page has no slug", () => {
    expect(resolvePage(pages, "pg_missing")).toBeUndefined();
  });

  test("an empty pages list has no slug", () => {
    expect(resolvePage([], "pg_first")).toBeUndefined();
  });
});

describe("relative change times", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  test.each([
    ["2026-11-08T12:00:00Z", "now"],
    ["2026-11-08T11:59:59Z", "1 second ago"],
    ["2026-11-08T11:58:00Z", "2 minutes ago"],
    ["2026-11-08T10:00:00Z", "2 hours ago"],
    ["2026-11-07T12:00:00Z", "yesterday"],
    ["2026-10-09T12:00:00Z", "last month"],
    ["2025-11-08T12:00:00Z", "last year"],
    ["2026-11-08T12:02:00Z", "in 2 minutes"],
  ])("formats %s using the supplied clock", (createdAt, expected) => {
    expect(relativeTime(createdAt, now)).toBe(expected);
  });
});
