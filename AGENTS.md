# AGENTS.md — Memtavi

Standing instructions for every agent in this workspace. Command Code loads this file into the system prompt on every turn, so it stays short on purpose. Everything else lives in `context/` and is read only when a route below says to.

## Read first

1. This file.
2. `context/status.md` if you are resuming or picking up work.
3. Every node your route names and every node in your brief's `Context:` line, to its last line.

Never read a node "to be safe". Each one is a real token cost, and the route table exists so you don't have to guess.

## Non-negotiables

- **Secrets.** Never read, print or modify `.env*`. Use the names `OPENROUTER_API_KEY` and `OPENAI_API_KEY`; never their values.
- **Git.** Never commit, push, stash, reset, rebase or switch branches. Only the orchestrator commits, and only when asked.
- **Scope.** Change only the files in your brief's `Paths:`. The guard fails the run otherwise.
- **Verification.** Run the brief's `Done when` commands and paste the real output into the report. A green report is not proof; the orchestrator re-runs them.
- **No comments** in code unless the brief asks for one. No docstrings for their own sake.
- **No Claude, one exception.** Do not invoke the `claude` CLI or pin a `claude-*` model in `cmd`, `grok` or `sol`. The only permitted use is the `agy` UI lane's last-resort fallback: Gemini 3.8 Flash first, Gemini 4 Argon only after the Gemini pool is spent, Claude only after Argon is spent or absent on the current account, and only when `agy models` lists it. Every fallback is recorded in the ledger.
- **No attribution.** No `Co-Authored-By`, no "generated with", no assistant names in commits, PRs, code or comments.
- **No real model calls in tests.** Unit and integration tests use `FakeProvider`. Only `tests/eval` may call a provider, and only with an explicit budget.

## Routes

Pick the row matching what you are touching. If you touch several areas, read the union, but nothing more.

| Task touches | Read |
|---|---|
| `apps/api/**`, `packages/spec/**` | conv-api, conv-code, conv-tests |
| `packages/db/**`, migrations, RLS | conv-db, conv-code, conv-tests |
| `packages/core/**`, `packages/llm/**` | conv-compiler, conv-code, conv-tests |
| `apps/worker/**` | conv-compiler, conv-db, conv-code |
| `apps/web/**` | conv-web, conv-code, conv-tests |
| auth, tenancy, API keys, URL or file fetch | conv-security |
| routing work, writing a brief, reviewing | agents-lanes, agents-workflow, agents-dispatch |
| resuming, "what's next" | status |
| recording a decision or a shipped change | gl-decisions, gl-changelog |
| read-only exploration | only what the brief names |

## Verification

Target commands, wired in Phase 0. Until they exist, a brief names the substitute.

```
bun run typecheck        bun run test:unit        bun run test:integration
bun run test:isolation   bun run test:contract    bun run spec:compat
bun run eval:smoke       bun run bench:search
```

## Workflow in six lines

**Lane in one line:** UI → `agy`; frontend logic → `fe` (sol, or grok once Codex's 5-hour usage passes 70%); boss-level backend → `sol`; other backend → `cmd`, with `grok` for medium work and load relief. The tier table is in agents-lanes.

1. Classify the work (agents-lanes), then write the contract into the brief or `gl-decisions`.
2. Write `.agents/tasks/<id>.md` from the template in agents-workflow.
3. `tools/agent.sh .agents/tasks/<id>.md` — one dispatch per background shell.
4. Read the report and the **full diff**; re-run the `Done when` commands.
5. Write `.agents/reviews/<id>-r<N>.md`: `APPROVED` or `CHANGES REQUESTED` with numbered findings.
6. Every finding blocks approval. Fixes go back to the agent, never into the orchestrator's hands.

## Node index

<!-- nodes:start -->
| Node | KB | Read when | Holds |
|---|---|---|---|
| [agents-agy](./context/agents-agy.md) | 2.7 | routing UI work, choosing an agy model, debugging a quota failure | agy quota groups, model chain, per-account availability, fallback rules |
| [agents-dispatch](./context/agents-dispatch.md) | 5.4 | running tools/agent.sh, reading an exit code, debugging a lane | Commands, exit codes, lane flags, installed CLIs |
| [agents-lanes](./context/agents-lanes.md) | 5.9 | routing a task, choosing a lane, a lane is out | Roles, harnesses, tiers, UI vs frontend logic, escalation, reroutes |
| [agents-workflow](./context/agents-workflow.md) | 4.8 | writing a brief, reviewing a diff, running a fix round | The loop, the brief template, the review checklist, verdicts |
| [conv-api](./context/conv-api.md) | 3.5 | touching apps/api or packages/spec | Spec-first contract, wire compatibility, error envelope, pagination, idempotency |
| [conv-code](./context/conv-code.md) | 2.7 | writing or reviewing any TypeScript in this repo | Language, module layout, error handling, logging, naming |
| [conv-compiler](./context/conv-compiler.md) | 3.6 | touching packages/core, packages/llm, a prompt, or a policy | Pipeline stages, policy bands, prompt versioning, determinism, eval gates |
| [conv-db](./context/conv-db.md) | 3.5 | touching packages/db, a migration, a query, RLS | Schema rules, migrations, tenancy enforcement, pgvector and FTS |
| [conv-security](./context/conv-security.md) | 3.4 | auth, tenancy, API keys, cookies, URL or file fetch, logging | Threats that apply here and the rule that answers each |
| [conv-tests](./context/conv-tests.md) | 2.6 | writing a test, choosing a Done when, re-running verification | What each suite must prove, the commands, and what is forbidden |
| [conv-web](./context/conv-web.md) | 3.0 | touching apps/web | Inspector stack, state boundaries, evidence UI, accessibility |
| [gl-changelog](./context/gl-changelog.md) | 2.2 | recording or checking what shipped | Shipped changes, newest first, dated |
| [gl-decisions](./context/gl-decisions.md) | 4.0 | checking or recording a decision | Accepted decisions, newest last, dated |
| [status](./context/status.md) | 2.2 | resuming work, deciding what to do next | The short list of work in flight, each pointing at its node |
<!-- nodes:end -->
