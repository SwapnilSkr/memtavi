import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createFakeProvider } from "@memtavi/llm/fake";
import { ProviderError } from "@memtavi/llm/provider";
import { buildExtractionMessages, CompileError, extractFacts } from "./extract";
import { applyPatch, buildPatchMessages, parsePatchResult } from "./patch";
import { decideMws } from "./policies/mws";
import { decidePfs } from "./policies/pfs";
import { prompts, promptVersion } from "./prompts";
import { type ExtractedFact, extractedFactSchema, routeDecisionSchema } from "./schemas";

const fact: ExtractedFact = {
  claim: "Alpha",
  kind: "project_fact",
  entities: [],
  evidence: { chunkUuid: "a", charStart: 0, charEnd: 5, quote: "Alpha" },
  confidence: 1,
  durability: 1,
  impact: 1,
  recurrence: 1,
  novelty: 1,
  futureUse: 1,
  sensitivity: "none",
};
const chunks = [{ chunkUuid: "a", text: "Alpha beta" }];
const config = { model: "fake-compiler-v1", promptVersion: promptVersion("extract") };

test("claims without evidence are dropped while supported facts survive", async () => {
  const unsupported = { ...fact, evidence: undefined };
  expect(extractedFactSchema.safeParse(unsupported).success).toBe(false);
  const provider = createFakeProvider({
    chatResponses: [JSON.stringify({ facts: [unsupported, fact] })],
  });
  const result = await extractFacts(provider, chunks, config);
  expect(result.facts).toEqual([fact]);
  expect(result.droppedFacts).toBe(1);
});

test.each([
  ["unknown chunk", { chunkUuid: "missing" }],
  ["empty range", { charEnd: 0 }],
  ["reversed range", { charStart: 6 }],
  ["absent quote", { quote: "Invented" }],
  ["wrong offsets even when quote exists", { charStart: 1, charEnd: 6 }],
  ["out of bounds end", { charEnd: 100 }],
])("drops unsupported evidence: %s", async (_name, evidence) => {
  const provider = createFakeProvider({
    chatResponses: [
      JSON.stringify({ facts: [fact, { ...fact, evidence: { ...fact.evidence, ...evidence } }] }),
    ],
  });
  const result = await extractFacts(provider, chunks, config);
  expect(result.facts).toEqual([fact]);
  expect(result.droppedFacts).toBe(1);
});

test.each([
  "not json",
  "{}",
  '{"facts":[{}]}',
  JSON.stringify({ facts: [{ ...fact, confidence: 1.1 }] }),
  JSON.stringify({ facts: [{ ...fact, kind: "fact" }] }),
  JSON.stringify({ facts: [{ ...fact, sensitivity: "public" }] }),
  JSON.stringify({ facts: [{ ...fact, validFrom: "yesterday" }] }),
  JSON.stringify({
    facts: [{ ...fact, validFrom: "2026-02-01T00:00:00Z", validTo: "2026-01-01T00:00:00Z" }],
  }),
])("invalid extraction output is a permanent safe error: %s", async (text) => {
  const provider = createFakeProvider({ chatResponses: [text] });
  const error = await extractFacts(provider, chunks, config).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(CompileError);
  expect(error).toMatchObject({
    code: "invalid_output",
    transient: false,
    status: 422,
    message: "Compiler output failed validation",
  });
});

test("provider failures preserve their retry classification", async () => {
  const error = await extractFacts(createFakeProvider(), chunks, config).catch(
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({ code: "fake_exhausted", transient: false });
});

test("extraction sorts chunks, validates prompt version and rejects duplicate chunk ids before calling", async () => {
  const batch = [...chunks, { chunkUuid: "b", text: "Beta" }];
  expect(buildExtractionMessages(batch, config.promptVersion)).toEqual(
    buildExtractionMessages([...batch].reverse(), config.promptVersion),
  );
  const provider = createFakeProvider();
  await expect(
    extractFacts(provider, chunks, { ...config, promptVersion: "stale" }),
  ).rejects.toBeInstanceOf(CompileError);
  await expect(extractFacts(provider, [...chunks, ...chunks], config)).rejects.toBeInstanceOf(
    CompileError,
  );
  expect(provider.calls).toHaveLength(0);
});

test.each(["confidence", "durability", "impact", "recurrence", "novelty", "futureUse"] as const)(
  "%s rejects out of range scores",
  (key) => {
    for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(extractedFactSchema.safeParse({ ...fact, [key]: value }).success).toBe(false);
    }
  },
);

test.each([
  ["preference", true],
  ["project_fact", true],
  ["decision", true],
  ["entity_attribute", true],
  ["event", true],
  ["commitment", true],
  ["other", true],
  ["fact", false],
  ["task", false],
  ["relationship", false],
  ["invented", false],
] as const)("fact kind %s has acceptance %s", (kind, accepted) => {
  expect(extractedFactSchema.safeParse({ ...fact, kind }).success).toBe(accepted);
});

test.each([
  ["none", true],
  ["personal", true],
  ["secret", true],
  ["regulated", true],
  ["public", false],
  ["internal", false],
  ["invented", false],
] as const)("fact sensitivity %s has acceptance %s", (sensitivity, accepted) => {
  expect(extractedFactSchema.safeParse({ ...fact, sensitivity }).success).toBe(accepted);
});

test.each([
  {},
  { validFrom: "2026-01-01T00:00:00Z" },
  { validTo: "2026-02-01T00:00:00Z" },
  { validFrom: "2026-01-01T00:00:00Z", validTo: "2026-01-01T00:00:00Z" },
  { validFrom: "2026-01-01T00:00:00Z", validTo: "2026-02-01T00:00:00Z" },
])("facts preserve optional top-level validity timestamps: %j", async (validity) => {
  const datedFact = { ...fact, ...validity };
  expect(extractedFactSchema.parse(datedFact)).toEqual(datedFact);
  const provider = createFakeProvider({ chatResponses: [JSON.stringify({ facts: [datedFact] })] });
  const result = await extractFacts(provider, chunks, config);
  expect(result.facts[0]).toMatchObject(validity);
  expect(result.facts[0]).not.toHaveProperty("validityWindow");
});

test("fact schema rejects invalid top-level timestamps and noninteger evidence offsets", () => {
  for (const invalid of [
    { validFrom: "yesterday" },
    { validTo: "tomorrow" },
    { validFrom: "2026-01-01" },
    { validTo: "2026-01-01T00:00:00+02:00" },
    { validFrom: "2026-02-01T00:00:00Z", validTo: "2026-01-01T00:00:00Z" },
    { evidence: { ...fact.evidence, charStart: -1 } },
    { evidence: { ...fact.evidence, charEnd: 1.5 } },
  ])
    expect(extractedFactSchema.safeParse({ ...fact, ...invalid }).success).toBe(false);
});

test.each([
  [0, "source_only"],
  [0.349, "source_only"],
  [0.35, "provisional"],
  [0.649, "provisional"],
  [0.65, "durable"],
  [1, "durable"],
] as const)("MWS signal level %s uses band %s", (value, band) => {
  expect(
    decideMws({
      ...fact,
      durability: value,
      impact: value,
      recurrence: value,
      novelty: value,
      futureUse: value,
      confidence: value,
    }).band,
  ).toBe(band);
});

test.each(["secret", "regulated"] as const)(
  "MWS hard-gates %s despite maximal utility",
  (sensitivity) => {
    expect(decideMws({ ...fact, sensitivity })).toEqual({
      band: "source_only",
      score: 0,
      reason: "sensitivity",
    });
  },
);

test.each(["none", "personal"] as const)(
  "MWS scores %s without the sensitivity gate",
  (sensitivity) => {
    expect(decideMws({ ...fact, sensitivity })).toEqual({
      band: "durable",
      score: 1,
      reason: "score",
    });
  },
);

test("unsuitable material subtracts the configured penalty and clamps at zero", () => {
  expect(decideMws({ ...fact, unsuitableMaterial: 1 }).score).toBe(0.7);
  expect(decideMws({ ...fact, unsuitableMaterial: 1 }, { unsuitablePenalty: 0.7 }).band).toBe(
    "source_only",
  );
  expect(decideMws({ ...fact, unsuitableMaterial: 1 }, { unsuitablePenalty: 2 }).score).toBe(0);
  expect(() => decideMws({ ...fact, unsuitableMaterial: Number.NaN })).toThrow(RangeError);
  expect(() => decideMws({ ...fact, confidence: -1 })).toThrow(RangeError);
});

const page = { id: "pg_a", slug: "alpha", createdAt: "2026-01-01T00:00:00Z", score: 0.6 };

test("routing includes every near-tied page in oldest-then-slug order regardless of insertion order", () => {
  const candidates = [
    { ...page, id: "pg_newer", createdAt: "2026-02-01T00:00:00Z" },
    { ...page, id: "pg_z", slug: "zulu" },
    { ...page, id: "pg_low", score: 0.3 },
    page,
    { ...page, id: "pg_score_first", score: 0.61, createdAt: "2026-03-01T00:00:00Z" },
  ];
  const result = decidePfs(candidates);
  expect(result).toMatchObject({
    action: "review",
    candidateIds: ["pg_score_first", "pg_a", "pg_z", "pg_newer"],
  });
  expect(decidePfs([...candidates].reverse())).toEqual(result);
  expect(candidates[0]?.id).toBe("pg_newer");
});

test("routing uses id as a final stable fallback for identical slugs and ages", () => {
  expect(decidePfs([{ ...page, id: "pg_z" }, page])).toMatchObject({
    action: "review",
    candidateIds: ["pg_a", "pg_z"],
  });
});

test.each([
  [[], "new"],
  [[{ ...page, score: 0.449 }], "new"],
  [[{ ...page, score: 0.45 }], "place"],
  [[page, { ...page, id: "pg_b", score: 0.45 }], "place"],
  [[page, { ...page, id: "pg_b", score: 0.451 }], "review"],
  [
    [
      { ...page, score: 0.45 },
      { ...page, id: "pg_b", score: 0.44 },
    ],
    "review",
  ],
] as const)("routing observes thresholds for %j", (candidates, action) => {
  const result = decidePfs(candidates);
  expect(result.action).toBe(action);
  expect(routeDecisionSchema.safeParse(result).success).toBe(true);
});

test("routing rejects non-finite scores and invalid ages", () => {
  for (const invalid of [{ score: Number.NaN }, { score: 1.1 }, { createdAt: "bad" }]) {
    expect(() => decidePfs([{ ...page, ...invalid }])).toThrow(RangeError);
  }
});

const existing = { title: "Human title", summary: "Human summary", body: "Human body\n" };
const patch = {
  title: "New title",
  summary: "New summary",
  body: "New evidence",
  changed: true,
  contradictions: [],
};
const contradiction = {
  existingClaim: "Beta",
  newClaim: fact.claim,
  evidence: fact.evidence,
};

test("contradictions win over the user-edit append path even when changed is false", () => {
  const result = applyPatch(
    existing,
    parsePatchResult(JSON.stringify({ ...patch, changed: false, contradictions: [contradiction] })),
    { userEdited: true },
  );
  expect(result).toEqual({
    ...existing,
    action: "contested",
    changed: false,
    contradictions: [contradiction],
  });
  expect(result.contradictions[0]?.evidence).toEqual(fact.evidence);
  expect(existing.body).toBe("Human body\n");
});

test("unchanged patches preserve every human field", () => {
  expect(applyPatch(existing, { ...patch, changed: false }, { userEdited: true })).toEqual({
    ...existing,
    action: "unchanged",
    changed: false,
    contradictions: [],
  });
});

test("manual edits are preserved byte for byte and sources are sorted and deduplicated", () => {
  const other = { ...fact, evidence: { ...fact.evidence, chunkUuid: "z" } };
  const result = applyPatch(existing, patch, { userEdited: true, facts: [other, fact, fact] });
  expect(result.title).toBe(existing.title);
  expect(result.summary).toBe(existing.summary);
  expect(result.body).toBe(
    'Human body\n\n\n## Updates\n\nNew evidence\n\n## Sources\n- a:0-5 "Alpha"\n- z:0-5 "Alpha"',
  );
  expect(applyPatch(existing, patch, { userEdited: true, facts: [fact, other] })).toEqual(result);
});

test.each([
  "not JSON",
  "{}",
  JSON.stringify({ ...patch, changed: "yes" }),
  JSON.stringify({ ...patch, contradictions: [1] }),
  JSON.stringify({ ...patch, contradictions: ["Conflict"] }),
  JSON.stringify({ ...patch, contradictions: [{ ...contradiction, existingClaim: "" }] }),
  JSON.stringify({ ...patch, contradictions: [{ ...contradiction, newClaim: "" }] }),
  JSON.stringify({ ...patch, contradictions: [{ ...contradiction, evidence: undefined }] }),
  JSON.stringify({
    ...patch,
    contradictions: [{ ...contradiction, evidence: { ...fact.evidence, charEnd: 1.5 } }],
  }),
  JSON.stringify({
    ...patch,
    contradictions: [{ ...contradiction, evidence: { ...fact.evidence, quote: "" } }],
  }),
])("patch output validates permanently: %s", (text) => {
  expect(() => parsePatchResult(text)).toThrow(CompileError);
});

test("patch messages sort facts and pin the prompt hash", () => {
  const other = { ...fact, claim: "Beta" };
  const options = { userEdited: true, promptVersion: promptVersion("patch") };
  expect(buildPatchMessages(existing, [fact, other], options)).toEqual(
    buildPatchMessages(existing, [other, fact], options),
  );
  expect(() => buildPatchMessages(existing, [], { ...options, promptVersion: "stale" })).toThrow(
    CompileError,
  );
});

test("prompt versions are SHA-256 hashes of exact text bytes", () => {
  for (const name of ["extract", "patch"] as const) {
    expect(promptVersion(name)).toBe(createHash("sha256").update(prompts[name]).digest("hex"));
    expect(promptVersion(name)).toHaveLength(64);
  }
  expect(promptVersion("extract")).not.toBe(promptVersion("patch"));
});
