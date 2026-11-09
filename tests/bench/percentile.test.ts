import { describe, expect, test } from "bun:test";
import { percentile, roundTo } from "./percentile";

describe("percentile", () => {
  test("returns null for an empty sample", () => {
    expect(percentile([], 0)).toBeNull();
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([], 0.95)).toBeNull();
  });

  test("returns the only value for any percentile", () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  test("interpolates an odd-length sample", () => {
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });

  test("interpolates an even-length sample", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(3.85);
    expect(percentile([4, 3, 2, 1], 0.5)).toBe(2.5);
  });

  test("rounds to the requested precision", () => {
    expect(percentile([1.23456], 0.5)).toBe(1.235);
    expect(percentile([1.23456], 0.5, 2)).toBe(1.23);
    expect(percentile([1.23456], 0.5, 0)).toBe(1);
    expect(roundTo(2.34567, 1)).toBe(2.3);
    expect(roundTo(2.35, 1)).toBe(2.4);
  });

  test("leaves the input order untouched", () => {
    const values = [5, 1, 4, 2, 3];
    percentile(values, 0.5);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });

  test("rejects a percentile outside zero to one", () => {
    expect(() => percentile([1], -0.1)).toThrow(RangeError);
    expect(() => percentile([1], 1.1)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });
});
