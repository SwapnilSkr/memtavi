---
id: agents-lanes
when: routing a task, choosing a lane, a lane is out
holds: Roles, harnesses, tiers, UI vs frontend logic, escalation, reroutes
links: agents-workflow, agents-dispatch, agents-agy
---

# Lanes and routing

## Roles

| Role | Harness | Model | Owns |
|---|---|---|---|
| **Orchestrator and reviewer** | Command Code, interactive (this session) | whatever the session runs | Contracts, briefs, routing, review of every diff, decisions, commits only when asked |
| **`cmd`** | Command Code CLI (`cmd -p`) | `deepseek/deepseek-v4.1-flash`, effort high | The backend workhorse: normal through extremely hard |
| **`grok`** | Cursor CLI (`cursor-agent`) | `grok-4.7-high` | Medium backend, and relief when `cmd` is saturated; cross-model audits |
| **`sol`** | Codex CLI (`codex exec`) | `gpt-6.1-sol`, effort high | Boss-level backend, and heavy frontend logic while Codex has headroom |
| **`agy`** | Antigravity (`agy -p`) | `gemini-3.8-flash-high` by default | UI only: markup, styling, layout, presentation |

**No Claude**, except the `agy` UI lane's last resort. Nothing else invokes the `claude` CLI or pins a `claude-*` model.

### The `agy` model chain

Flash is the default; Argon (a separate weekly-only pool) is used only after Gemini's five-hour and weekly limits are spent; Claude (a third group) only after Argon is spent or absent on the account. Availability is per account and is probed before every dispatch. Full mechanics: [agents-agy](./agents-agy.md).

**The orchestrator never delegates review.** It reads every changed line. A green report, a passing guard and a green conventions check inform the review; they never replace it.

## Choosing a lane

| Tier | The task… | Lane |
|---|---|---|
| **S** | changes the compiler pipeline, a policy weight, a prompt contract or the extraction schema; touches auth, tenancy, RLS or key handling; rewrites data in a migration; introduces concurrency or a cross-service contract; is "boss level" in the owner's words | `sol` |
| **A** | is hard backend where a pattern exists but decisions remain: a new endpoint with real validation, a new query with index choices, a data-write path | `cmd` |
| **B** | is medium backend: logic inside one package, rules written, moderate ambiguity, a state machine | `grok` |
| **C** | is fully specified and copies a named pattern: route plumbing, DTOs, repository methods, error mapping, tests for written behaviour | `cmd` |
| **D** | is read-only (map a package, find callers, audit a diff) or a small mechanical edit | `cmd` |
| **UI** | changes what the user sees: markup, Tailwind, layout, responsive behaviour, a11y attributes, a presentational component | `agy` |
| **FE** | changes what the app does: hooks with behaviour, query keys, mutations and invalidation, routing logic, client-side state machines | `fe` |

**`fe` is a router, not a harness.** At dispatch time it resolves to `sol` while Codex's 5-hour usage is at or below `CODEX_FE_CEILING` (default 70), and to `grok` above that. If usage is unknown it uses `sol` and warns; see `tools/lane_usage.py`. `Lane: sol` or `Lane: grok` still forces that lane.

**UI versus FE is a behavioural test, not a file split.** If the change can only break by looking wrong, it is UI. If it can break by fetching the wrong thing, invalidating the wrong key, or entering the wrong state, it is FE and goes to `fe`. A task that does both is split into two briefs.

## Load distribution

`cmd` and the orchestrator share a provider. When the orchestrator has been running long or `cmd` has handled several tasks, medium backend work goes to `grok` instead of stacking it on `cmd`. `grok` is trusted at or slightly below `deepseek` for backend work; the tier table says which one is allowed, not which one is preferable.

`sol` is expensive and reserved. Do not spend it on anything a cheaper lane can do to the same standard, and never downgrade a Tier S task to save quota.

## Routing a feature

1. **Read pass** (`cmd`, read mode) maps the packages and patterns the change reuses.
2. **Contract** (orchestrator) writes shapes, enums, statuses and the failure vocabulary into the brief or `gl-decisions`.
3. **Core** (`sol` when Tier S, otherwise `cmd`) writes the pipeline, policy or tenancy change.
4. **Plumbing in parallel** (`cmd`, disjoint `Paths:`) writes routes, DTOs and tests against the written contract.
5. **Cross-model audit** (`grok`, read mode) reviews every Tier S diff.
6. **Frontend** (`agy` for UI, `fe` for FE) against the frozen contract.

## Parallelism

- One running task each on `sol`, `grok` and `agy`; up to two on `cmd`.
- Tasks never share a path. The guard refuses an overlapping lock.
- Single-owner files: `packages/spec/openapi.yaml`, `packages/db/schema.ts`, `packages/db/migrations/**`, the root `package.json`, the job type registry, and `apps/web/src/lib/query.ts`. One task owns each at a time; everyone else records the change it needs in the report.

## Escalation

Backend: after two `CHANGES REQUESTED` rounds, the next round moves up (`cmd` → `grok` → `sol`). A Tier S task never moves down.

UI: a UI task that fails twice is split, or re-briefed with the failing screenshots. It is never sent to a backend lane, because a backend lane will make it work and look wrong.

FE: `fe` re-resolves on every dispatch, so a Codex-heavy day sends it to `grok` without a new brief. The orchestrator rewrites the brief rather than escalating.

## When a lane is out

Write `<lane>=<replacement>` lines to `.agents/reroute`, dated in a comment, and delete them when the quota resets.

| Out | Reroute to | Never to |
|---|---|---|
| `cmd` | `grok` | `sol` for Tier C/D |
| `grok` | `cmd` | `sol` |
| `sol` | `grok` for `fe`; **wait** for Tier S | `cmd` |
| `agy` | **wait** | any backend lane |

## Ledger

One line per dispatch in `.agents/ledger.tsv`. If a lane keeps failing a task type, re-tier it here.
