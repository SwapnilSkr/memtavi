import { expect, test } from "bun:test";
import { latestContradiction, readClaims } from "./contradictions";

const older = {
  pageId: "pg_a",
  createdAt: "2026-11-01T00:00:00.000Z",
  contradictions: [{ existingClaim: "Old", newClaim: "Older new" }],
};
const newer = {
  pageId: "pg_a",
  createdAt: "2026-11-02T00:00:00.000Z",
  contradictions: [{ existingClaim: "Old", newClaim: "Newer" }],
};
const empty = {
  pageId: "pg_a",
  createdAt: "2026-11-03T00:00:00.000Z",
  contradictions: [],
};
const other = {
  pageId: "pg_b",
  createdAt: "2026-11-04T00:00:00.000Z",
  contradictions: [{ existingClaim: "Other", newClaim: "Elsewhere" }],
};

test("the latest contradiction is chosen by time, not by input order", () => {
  expect(latestContradiction([older, empty, newer, other], "pg_a")).toBe(newer);
  expect(latestContradiction([newer, older], "pg_a")).toBe(newer);
});

test("a page with only empty contradiction lists has no event", () => {
  expect(latestContradiction([empty], "pg_a")).toBeUndefined();
});

test("claim pairs keep both claims and a quote when the evidence has one", () => {
  expect(
    readClaims([
      {
        existingClaim: "Ships Friday",
        newClaim: "Ships Monday",
        evidence: { quote: "Ships Monday" },
      },
      "not a claim",
      { existingClaim: "", newClaim: "Missing the old claim" },
      { existingClaim: "Kept", newClaim: "Also kept" },
    ]),
  ).toEqual([
    { existingClaim: "Ships Friday", newClaim: "Ships Monday", quote: "Ships Monday" },
    { existingClaim: "Kept", newClaim: "Also kept" },
  ]);
});
