---
id: conv-compiler
when: touching packages/core, packages/llm, a prompt, or a policy
holds: Pipeline stages, policy bands, prompt versioning, determinism, eval gates
links: conv-db, conv-tests
---

# Compiler conventions

The compiler is the product. Everything else is plumbing. These rules exist because a plausible-looking change here is indistinguishable from a regression without a measurement.

## Pipeline

```
extract text → chunk & dedupe → extract facts → MWS → PFS route
             → patch → record version → embed → discover connections → emit
```

Each stage is a separate job type with its own attempts. A page may be recorded even when embedding fails; the source then reports `failed` and is retryable.

## Contracts

- Every model call returns structured output validated by a Zod schema in `packages/core/compile/schemas.ts`. A parse failure is a permanent error for that job, not a retry.
- Extraction must return an evidence span: `chunkUuid`, `charStart`, `charEnd`, `quote`. A claim without a span is dropped.
- Policy functions are pure: `(facts, candidates, config) => decisions`. No I/O, no randomness, no clock inside them. Time is passed in.

## Policy bands

| Policy | Decides | Bands |
|---|---|---|
| MWS | keep the fact? | `≥0.65` durable, `0.35–0.65` provisional, `<0.35` source-only |
| PFS | which page? | `gap ≥ 0.15` place, smaller gap and `best ≥ 0.45` review, else new page |
| CRS | link to what? | `strong`, `medium`, `weak`, noise dropped |
| RPS | resurface when? | task fit plus urgency minus fatigue |

The `review` band is mandatory. A near-tie between two pages must never become a merge; it becomes a `routing_reviews` row. A page that blends two customers reads smoothly and answers wrongly about both.

Restated from the reference product: a policy score orders decisions inside a brain. It is not the probability that a fact is true, and it is never shown to a user as one.

## Prompts

- Prompts are files under `packages/llm/prompts/`, versioned by content hash. The hash is stored on the page version that a compile produced.
- Pin model ids in config. Never `latest`. Temperature 0 for extraction, routing judgement and patching.
- A prompt change is a behaviour change: it needs an eval run in the same task, and the numbers go in the report.
- Extraction prompts must refuse to invent. If the source does not say it, it is not a fact.

## Determinism

- The same source, same model, same prompt, same empty brain must produce the same page. A golden-corpus test asserts this.
- Iteration order over candidates and connections is sorted, never map-insertion order.
- Any tie in PFS or CRS is broken by a documented rule (page age, then slug), not by chance.

## Cost

- Every provider call writes a `usage_ledger` row with tokens and computed USD.
- Embed compiled pages, not chat turns and not chunks. Reuse by `content_hash`.
- A capture whose estimated cost exceeds the tenant's remaining budget is rejected with `402`-style `429` semantics, not silently truncated.

## Manual edits

If `pages.user_edited_at > pages.last_compiled_at`, the compiler appends an `## Updates` section and never rewrites the body. Only a human edit clears the flag, and only an explicit user action does so.

## What blocks a compiler change

A compiler task is not done until its brief's `Done when` includes a measurable gate: eval accuracy or recall on the relevant slice, the merge-safety set for routing changes, or a golden-corpus diff for prompt changes. "Looks right" is not a result.
