import { describe, expect, test } from "bun:test";
import { formatDate, formatDateTime, formatRelative } from "./format";

describe("formatDate", () => {
  test("formats standard ISO string with en-US locale", () => {
    const formatted = formatDate("2026-11-07T13:46:32.898Z", "en-US");
    expect(formatted).toBe("Nov 7, 2026");
  });

  test("handles Date instance and timestamp", () => {
    const d = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    expect(formatDate(d, "en-US")).toBe("Jan 15, 2026");
    expect(formatDate(d.getTime(), "en-US")).toBe("Jan 15, 2026");
  });

  test("returns empty string on invalid date", () => {
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("formatDateTime", () => {
  test("formats standard ISO string with en-US locale", () => {
    const formatted = formatDateTime("2026-11-07T13:46:32.898Z", "en-US");
    expect(formatted).toContain("Nov 7, 2026");
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  test("returns empty string on invalid date", () => {
    expect(formatDateTime("not-a-date")).toBe("");
  });
});

describe("formatRelative", () => {
  const base = new Date("2026-11-07T12:00:00.000Z");

  test("formats seconds ago or now", () => {
    expect(formatRelative(base, base, "en-US")).toBe("now");
    const pastSec = new Date(base.getTime() - 15 * 1000);
    expect(formatRelative(pastSec, base, "en-US")).toBe("15 seconds ago");
  });

  test("formats minutes ago", () => {
    const pastMin = new Date(base.getTime() - 5 * 60 * 1000);
    expect(formatRelative(pastMin, base, "en-US")).toBe("5 minutes ago");
  });

  test("formats hours ago", () => {
    const pastHour = new Date(base.getTime() - 3 * 3600 * 1000);
    expect(formatRelative(pastHour, base, "en-US")).toBe("3 hours ago");
  });

  test("formats yesterday and days ago", () => {
    const yesterday = new Date(base.getTime() - 24 * 3600 * 1000);
    expect(formatRelative(yesterday, base, "en-US")).toBe("yesterday");

    const threeDays = new Date(base.getTime() - 3 * 24 * 3600 * 1000);
    expect(formatRelative(threeDays, base, "en-US")).toBe("3 days ago");
  });

  test("formats months and years ago", () => {
    const twoMonths = new Date(base.getTime() - 65 * 24 * 3600 * 1000);
    expect(formatRelative(twoMonths, base, "en-US")).toBe("2 months ago");

    const twoYears = new Date(base.getTime() - 750 * 24 * 3600 * 1000);
    expect(formatRelative(twoYears, base, "en-US")).toBe("2 years ago");
  });

  test("formats future dates", () => {
    const tomorrow = new Date(base.getTime() + 24 * 3600 * 1000);
    expect(formatRelative(tomorrow, base, "en-US")).toBe("tomorrow");
  });

  test("returns empty string on invalid date", () => {
    expect(formatRelative("invalid", base)).toBe("");
  });
});
