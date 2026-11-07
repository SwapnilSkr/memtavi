import { describe, expect, test } from "bun:test";
import { exactMatch, normalize, tokenF1, tokenize } from "./judge";

describe("judge", () => {
  test.each([
    ["Hello, World!", "hello world"],
    ["The  Red\tVolvo", "red volvo"],
    ["Café", "cafe"],
    ["a b   c", "b c"],
    ["", ""],
  ])("normalize(%p) = %p", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  test("tokenize shares normalization", () => {
    expect(tokenize("The Atlas Project, ships in June.")).toEqual([
      "atlas",
      "project",
      "ships",
      "in",
      "june",
    ]);
  });

  test.each([
    ["Biscuit", "biscuit", true],
    ["The red Volvo.", "red volvo", true],
    ["June", "June 2026", false],
    ["", "", true],
    ["something", "", false],
  ])("exactMatch(%p, %p) = %p", (prediction, gold, expected) => {
    expect(exactMatch(prediction, gold)).toBe(expected);
  });

  test.each([
    ["Biscuit", "Biscuit", 1],
    ["red Volvo", "red Volvo", 1],
    ["Alice's dog is named Biscuit.", "Biscuit", 0.285714],
    ["forty thousand dollars", "forty thousand dollars", 1],
    ["nothing", "Biscuit", 0],
    ["", "Biscuit", 0],
    ["", "", 1],
  ])("tokenF1(%p, %p) = %p", (prediction, gold, expected) => {
    expect(tokenF1(prediction, gold)).toBeCloseTo(expected, 5);
  });

  test("token F1 counts repeated tokens as a multiset", () => {
    expect(tokenF1("very very good", "very good")).toBeCloseTo(0.8, 6);
    expect(tokenF1("very good", "very very good")).toBeCloseTo(0.8, 6);
  });
});
