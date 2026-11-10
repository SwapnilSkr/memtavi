---
id: gl-changelog-archive
when: looking up an older shipped change
holds: Shipped changes before the current phase, newest first
links: gl-changelog
---

# Archived change log

Still accurate. Moved here to keep the active changelog inside its node budget.

Newest first. One line per shipped change.

- **2026-11-06** — Contract compatibility diff: 3.1-aware baseline in `tests/contract`, `spec:compat` in CI, breaking changes fail with a JSON Pointer. 538 tests.
- **2026-11-06** — Backup/restore rehearsal: custom dump and restore with zero mismatches, RLS smoke pass, 0.38 s RTO on a schema-only DB; production-sized rerun pending.
- **2026-11-06** — 10k search benchmark: FTS p95 5–9 ms, vector p95 43–46 ms under RLS; documented in `docs/benchmarks.md`.
- **2026-11-06** — Guardrails: per-key rate limiting with 429/`Retry-After` and rate headers, Redis-free fixed windows, JSON request logs with no secrets, worker logger.
- **2026-11-06** — Budget caps enforced: `usage_ledger.created_at`, monthly spend check before every provider call, seeded `$20` hard cap, zero calls on breach.
- **2026-11-06** — Fern login, generator config and upgrades (superseded by the 2026-11-11 SDK entry).
- **2026-11-06** — Webhook delivery shipped: SSRF-safe POST, HMAC signatures, delivery records, retries and one delivery per matching webhook per change event.
- **2026-11-06** — Webhook registration shipped: encrypted write-once secrets, validated events, client and CLI commands. 167 integration, 509 unit tests.
- **2026-11-06** — Generated API reference: `docs/API.md` from the OpenAPI spec with a CI stale check.
- **2026-11-06** — Shared client and CLI shipped: `@memtavi/client` with all 20 operations, MCP rebased onto it, and `memtavi` CLI with 19 commands, `--json`, brain…
- **2026-11-06** — MCP write surface shipped: `remember` with deterministic idempotency and async semantics, plus `source_status`.
- **2026-11-06** — MCP read-only server shipped: stdio server with `list_brains`, `index`, `search`, `read`, API-key auth, brain resolution and stderr-only diagnostics.
- **2026-11-06** — Inspector connections/changes shipped: ackable connection list, change feed with version transitions and contradictions. 113 web tests.
- **2026-11-06** — Export and permanent delete shipped: JSON brain bundle, `permanent=true` guard, `deletion_ops` audit, cascade delete, inspector download and…

- **2026-11-06** — Inspector graph/score/profile shipped: deterministic graph, health meters with a 404 empty
- **2026-11-06** — Hardening: strict CSP for production/preview with a dev-only refresh allowance, and best-e
- **2026-11-06** — Inspector capture/edit shipped: note/URL capture with polling, page edit with 409 reload, 
- **2026-11-06** — Inspector shell shipped: Vite/React/Tailwind app with a typed API client, sessionStorage s
- **2026-11-06** — Phase 2 score/profile shipped: latest score snapshot, empty-default profile, partial profi
- **2026-11-06** — Phase 2 graph shipped: live-only graph nodes and edges, similarity-ordered connections, id
- **2026-11-06** — Phase 2 changes shipped: change feed, idempotent ack, and page PATCH with version conflict
- **2026-11-06** — Phase 2 read path shipped: pages list/get with `lastReferencedAt` bump, compact index, and
- **2026-11-06** — Page split shipped: batches over 6,000 characters become sibling pages with a `split` even
- **2026-11-06** — Patches batched per page: compile cost fell to $0.097 at real prices
- **2026-11-06** — Entity pages shipped: facts consolidate by entity, reviews resolve when one candidate shar
- **2026-11-06** — Routing instrumented: every PFS decision now carries best/second/gap/candidates, and the e
- **2026-11-06** — Session dates ingested into the compiled text; live slice moved from 5% to 15% exact and 1
- **2026-11-06** — First live eval recorded on a LoCoMo slice (conv-26, 20 questions, `openai/gpt-4.1-mini`):
- **2026-11-06** — Evidence spans re-anchored: a verbatim quote with wrong offsets is corrected instead of dr
- **2026-11-06** — Eval harness shipped: `tests/eval` compiles a labelled set through the real compiler, answ
- **2026-11-06** — `capture.compile` shipped: paragraph chunking to the store, extraction with evidence enfor
- **2026-11-06** — Two-tier storage shipped: migration `0008` (`body_ref`, `body_bytes`, nullable chunk text,
- **2026-11-06** — Storage live: private S3 + CloudFront with OAC, signed URLs, SSE-S3, lifecycle and least-p
- **2026-11-06** — `p1-compiler-core` approved: plan-exact fact and patch contracts, evidence-span enforcemen
- **2026-11-06** — `p1-llm` approved: provider interfaces, OpenRouter and OpenAI adapters, deterministic fake
- **2026-11-06** — `p1-worker` approved: leased job claim with `SKIP LOCKED`, backoff and dead-lettering, and
- **2026-11-06** — `p1-capture` approved: capture endpoints, source lifecycle, idempotent replay, `originRef`
- **2026-11-06** — Phase 0 complete
- **2026-11-06** — `p0-auth` approved: API-key issuance and revocation with the role ladder, tenant/subject s
- **2026-11-06** — `p0-spec` approved: OpenAPI 3.1, 23 paths, 32 operations, 40 schemas, error envelope, pagi
- **2026-11-06** — `p0-db` approved: 28-table Drizzle schema, 6 migrations, full tenant RLS including the six
- **2026-11-06** — Local database moved to Homebrew `postgresql@18` on 5434 with brew-managed pgvector 0.8.7 
- **2026-11-06** — `p0-workspaces` approved: Bun workspace, strict tsconfig, Biome, `@memtavi/shared` with pr
- **2026-11-06** — Codex usage found in its own rollouts (`rate_limits.primary`, 300 min)
- **2026-11-06** — `agy` defaults to `gemini-3.8-flash-high`
- **2026-11-06** — Lane policy set: `cmd` is the backend workhorse, `grok` medium and load relief, `sol` boss
- **2026-11-06** — Orchestration scaffold: `AGENTS.md`, 13 context nodes, `tools/{agent.sh,agent_guard.py,con
