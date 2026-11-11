import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createFakeProvider } from "@memtavi/llm/fake";
import { buildConnectMessages, type ConnectionPair, parseConnectResult } from "./connect";
import { CompileError } from "./errors";
import {
  CONNECTION_CANDIDATE_COUNT,
  CONNECTION_SIMILARITY_FLOOR,
  canonicalPair,
  isConnectionCandidate,
  strengthRose,
} from "./policies/crs";
import { prompts, promptVersion } from "./prompts";

const pair: ConnectionPair = {
  pageA: { id: "pg_a", title: "Acme", summary: "", body: "Acme builds Atlas." },
  pageB: { id: "pg_b", title: "Atlas", summary: "", body: "Atlas is built by Acme." },
  similarity: 0.8,
};
const judgement = {
  pageAId: "pg_a",
  pageBId: "pg_b",
  strength: "strong",
  reasoning: "Acme builds Atlas.",
};

test.each([0.449999, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.01])(
  "rejects similarity outside the candidate band: %s",
  (score) => {
    expect(isConnectionCandidate(score)).toBe(false);
  },
);

test.each([CONNECTION_SIMILARITY_FLOOR, 0.450001, 1])(
  "includes similarity at and above the floor: %s",
  (score) => {
    expect(isConnectionCandidate(score)).toBe(true);
  },
);

test("bounds discovery to eight candidates per touched page", () => {
  expect(CONNECTION_CANDIDATE_COUNT).toBe(8);
  expect(CONNECTION_SIMILARITY_FLOOR).toBe(0.45);
});

test("canonical pairs have the same order in either direction and exclude self pairs", () => {
  expect(canonicalPair("pg_b", "pg_a")).toEqual(["pg_a", "pg_b"]);
  expect(canonicalPair("pg_a", "pg_b")).toEqual(["pg_a", "pg_b"]);
  expect(() => canonicalPair("pg_a", "pg_a")).toThrow();
  expect(() => canonicalPair("", "pg_a")).toThrow();
});

test.each([
  ["weak", "weak", false],
  ["weak", "medium", true],
  ["weak", "strong", true],
  ["medium", "weak", false],
  ["medium", "medium", false],
  ["medium", "strong", true],
  ["strong", "weak", false],
  ["strong", "medium", false],
  ["strong", "strong", false],
] as const)("ack reset from %s to %s is %s", (previous, next, expected) => {
  expect(strengthRose(previous, next)).toBe(expected);
});

test.each(["strong", "medium", "weak", "noise"])("parses the %s judgement", (strength) => {
  const result = parseConnectResult(JSON.stringify({ connections: [{ ...judgement, strength }] }), [
    pair,
  ]);
  expect(result).toHaveLength(strength === "noise" ? 0 : 1);
  if (strength !== "noise") expect(result[0]?.strength).toBe(strength);
});

test.each([
  "invalid",
  "{}",
  '{"connections":[]}',
  JSON.stringify({ connections: [judgement, judgement] }),
  ...[
    { strength: "certain" },
    { reasoning: "" },
    { reasoning: "line one\nline two" },
    { reasoning: "a".repeat(501) },
    { pageAId: "pg_b", pageBId: "pg_a" },
    { pageBId: "pg_foreign" },
    { pageAId: "pg_b" },
  ].map((change) => JSON.stringify({ connections: [{ ...judgement, ...change }] })),
])("malformed, missing, duplicate and invented judgements fail permanently: %s", (text) => {
  expect(() => parseConnectResult(text, [pair])).toThrow(CompileError);
});

test("batched requests are deterministic and pin the content hash and model", async () => {
  const other = { ...pair, pageB: { ...pair.pageB, id: "pg_c" } };
  expect(buildConnectMessages([pair, other])).toEqual(buildConnectMessages([other, pair]));
  expect(promptVersion("connect")).toBe(createHash("sha256").update(prompts.connect).digest("hex"));
  const provider = createFakeProvider({
    chatResponses: [JSON.stringify({ connections: [judgement] })],
  });
  const response = await provider.chat({
    model: "fake-connect-v1",
    messages: buildConnectMessages([pair]),
    temperature: 0,
    responseFormat: "json",
  });
  expect(response.model).toBe("fake-connect-v1");
  expect(parseConnectResult(response.text, [pair])[0]?.reasoning).toBe(judgement.reasoning);
});
