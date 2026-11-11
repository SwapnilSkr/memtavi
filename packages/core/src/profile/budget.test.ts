import { expect, test } from "bun:test";
import { budgetExceeded } from "./budget";

test.each([
  { cap: undefined, spend: 100, estimate: 10, refused: false },
  { cap: { monthlyUsd: 1, hardStop: false }, spend: 100, estimate: 10, refused: false },
  { cap: { monthlyUsd: 1, hardStop: true }, spend: 1, estimate: 0, refused: true },
  { cap: { monthlyUsd: 1, hardStop: true }, spend: 0.5, estimate: 0.6, refused: true },
  { cap: { monthlyUsd: 1, hardStop: true }, spend: 0.5, estimate: 0.5, refused: false },
  { cap: { monthlyUsd: 0, hardStop: true }, spend: 0, estimate: 0, refused: true },
])("budget cap policy %#", ({ cap, spend, estimate, refused }) => {
  expect(budgetExceeded(cap, spend, estimate)).toBe(refused);
});
