import { expect, test } from "bun:test";
import { createFakeProvider } from "@memtavi/llm/fake";
import { extractFacts } from "./extract";
import { applyPatch, buildPatchMessages, parsePatchResult } from "./patch";
import { decideMws } from "./policies/mws";
import { decidePfs } from "./policies/pfs";
import { promptVersion } from "./prompts";
import { type ExtractedFact, routeDecisionSchema } from "./schemas";

const budgetText = "Budget approved from 2026-01-01T00:00:00Z to 2026-12-31T00:00:00Z.";
const chunks = [
  { chunkUuid: "chunk-alpha", text: "Acme renews annually. Lunch is at noon." },
  { chunkUuid: "chunk-beta", text: budgetText },
];

const durableFact: ExtractedFact = {
  claim: "Acme renews annually.",
  kind: "project_fact",
  entities: ["Acme"],
  evidence: { chunkUuid: "chunk-alpha", charStart: 0, charEnd: 21, quote: "Acme renews annually." },
  confidence: 1,
  durability: 0.9,
  impact: 0.8,
  recurrence: 0.9,
  novelty: 0.7,
  futureUse: 0.9,
  sensitivity: "none",
};

const provisionalFact: ExtractedFact = {
  ...durableFact,
  claim: "Budget approved.",
  kind: "decision",
  validFrom: "2026-01-01T00:00:00Z",
  validTo: "2026-12-31T00:00:00Z",
  evidence: {
    chunkUuid: "chunk-beta",
    charStart: 0,
    charEnd: budgetText.length,
    quote: budgetText,
  },
  confidence: 0.5,
  durability: 0.5,
  impact: 0.5,
  recurrence: 0.5,
  novelty: 0.5,
  futureUse: 0.5,
};

const ephemeralFact: ExtractedFact = {
  ...durableFact,
  claim: "Lunch is at noon.",
  kind: "event",
  evidence: { chunkUuid: "chunk-alpha", charStart: 22, charEnd: 39, quote: "Lunch is at noon." },
  confidence: 0.2,
  durability: 0.2,
  impact: 0.2,
  recurrence: 0.2,
  novelty: 0.2,
  futureUse: 0.2,
};

const existing = { title: "Acme", summary: "Account", body: "Human-maintained account notes." };
const patch = {
  title: "Acme renewal",
  summary: "Annual renewal",
  body: "Acme renews annually.",
  changed: true,
  contradictions: [],
};
const candidate = { id: "pg_acme", slug: "acme", createdAt: "2026-01-01T00:00:00Z", score: 0.8 };
const contradiction = {
  existingClaim: "Acme renews monthly.",
  newClaim: durableFact.claim,
  evidence: durableFact.evidence,
};

async function runGolden() {
  const provider = createFakeProvider({
    chatResponses: [
      JSON.stringify({ facts: [durableFact, provisionalFact, ephemeralFact] }),
      JSON.stringify(patch),
      JSON.stringify({ ...patch, contradictions: [contradiction] }),
      JSON.stringify({ ...patch, body: "Budget approved." }),
    ],
  });
  const extraction = await extractFacts(provider, chunks, {
    model: "fake-compiler-v1",
    promptVersion: promptVersion("extract"),
  });
  expect(extraction.facts).toEqual([durableFact, provisionalFact, ephemeralFact]);
  expect(extraction.facts.map(({ kind }) => kind)).toEqual(["project_fact", "decision", "event"]);
  expect(extraction.facts.map(({ sensitivity }) => sensitivity)).toEqual(["none", "none", "none"]);
  expect(extraction.facts[1]).toMatchObject({
    validFrom: "2026-01-01T00:00:00Z",
    validTo: "2026-12-31T00:00:00Z",
  });
  expect(extraction.facts[1]).not.toHaveProperty("validityWindow");
  expect(extraction.droppedFacts).toBe(0);
  expect(extraction.costUsd).toBeGreaterThan(0);
  const bands = extraction.facts.map((fact) => decideMws(fact).band);
  expect(bands).toEqual(["durable", "provisional", "source_only"]);

  const place = decidePfs([candidate, { ...candidate, id: "pg_other", score: 0.5 }]);
  const review = decidePfs([candidate, { ...candidate, id: "pg_other", score: 0.7 }]);
  const newPage = decidePfs([{ ...candidate, score: 0.44 }]);
  expect(place).toMatchObject({ action: "place", pageId: "pg_acme" });
  expect(review).toEqual({
    action: "review",
    candidateIds: ["pg_acme", "pg_other"],
    best: 0.8,
    second: 0.7,
    gap: 0.1,
  });
  expect(newPage.action).toBe("new");
  for (const route of [place, review, newPage])
    expect(routeDecisionSchema.safeParse(route).success).toBe(true);

  const decisions = [];
  for (const userEdited of [false, false, true]) {
    const response = await provider.chat({
      model: "fake-compiler-v1",
      messages: buildPatchMessages(existing, extraction.facts, {
        userEdited,
        promptVersion: promptVersion("patch"),
      }),
      temperature: 0,
      responseFormat: "json",
    });
    decisions.push(
      applyPatch(existing, parsePatchResult(response.text), {
        userEdited,
        facts: extraction.facts,
      }),
    );
  }
  expect(decisions[0]).toMatchObject({ action: "rewrite", title: "Acme renewal" });
  expect(decisions[0]?.body).toBe(
    `Acme renews annually.\n\n## Sources\n- chunk-alpha:0-21 "Acme renews annually."\n- chunk-alpha:22-39 "Lunch is at noon."\n- chunk-beta:0-${budgetText.length} "${budgetText}"`,
  );
  expect(decisions[1]).toMatchObject({ action: "contested", body: existing.body, changed: false });
  expect(decisions[1]?.contradictions).toEqual([contradiction]);
  expect(decisions[1]?.contradictions[0]?.evidence).toEqual(durableFact.evidence);
  expect(decisions[2]).toMatchObject({
    action: "append",
    title: existing.title,
    summary: existing.summary,
  });
  expect(decisions[2]?.body.startsWith(`${existing.body}\n\n## Updates\n\nBudget approved.`)).toBe(
    true,
  );
  expect(provider.calls).toHaveLength(4);
  for (const call of provider.calls) {
    expect(call.kind).toBe("chat");
    if (call.kind === "chat")
      expect(call.request).toMatchObject({
        temperature: 0,
        responseFormat: "json",
        model: "fake-compiler-v1",
      });
  }
  return { extraction, bands, place, review, newPage, decisions, calls: provider.calls };
}

test("golden corpus extracts, bands, routes and patches identically on two complete runs", async () => {
  const first = await runGolden();
  const second = await runGolden();
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});
