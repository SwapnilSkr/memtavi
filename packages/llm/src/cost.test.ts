import { expect, test } from "bun:test";
import { chatCostUsd, DEFAULT_CHAT_PRICES, embeddingCostUsd } from "./cost";

test("chat defaults follow the plan: $8/M in and $0.50/M out", () => {
  expect(DEFAULT_CHAT_PRICES).toEqual({
    inputPerMillionUsd: 8,
    outputPerMillionUsd: 0.5,
  });
  expect(chatCostUsd(1_000_000, 1_000_000)).toBe(8.5);
});

test("chat cost is linear and unrounded", () => {
  expect(chatCostUsd(1, 0)).toBe(8 / 1_000_000);
  expect(chatCostUsd(0, 1)).toBe(0.5 / 1_000_000);
  expect(chatCostUsd(3, 5)).toBe((3 * 8 + 5 * 0.5) / 1_000_000);
});

test("chat cost accepts explicit prices", () => {
  expect(
    chatCostUsd(2_000_000, 1_000_000, {
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 2,
    }),
  ).toBe(4);
});

test("chat cost of nothing is zero", () => {
  expect(chatCostUsd(0, 0)).toBe(0);
});

test("embedding defaults are $0.02/M input tokens", () => {
  expect(embeddingCostUsd(1_000_000)).toBe(0.02);
  expect(embeddingCostUsd(500_000)).toBe(0.01);
});

test("embedding cost is linear, unrounded and accepts explicit prices", () => {
  expect(embeddingCostUsd(1)).toBe(0.02 / 1_000_000);
  expect(embeddingCostUsd(1_500_000, { inputPerMillionUsd: 0.13 })).toBe(0.195);
  expect(embeddingCostUsd(0)).toBe(0);
});
