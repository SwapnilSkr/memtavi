---
id: gl-changelog
when: recording or checking what shipped
holds: Shipped changes, newest first, dated
links: status
---

# Change log

Newest first. One line per shipped change: what, where, why. Not a commit log.

- **2026-11-06** — MCP write surface shipped: `remember` with deterministic idempotency and async semantics, plus `source_status`. Six tools, no transcript tool. 68 package tests.
- **2026-11-06** — MCP read-only server shipped: stdio server with `list_brains`, `index`, `search`, `read`, API-key auth, brain resolution and stderr-only diagnostics. 46 package tests.
- **2026-11-06** — Inspector connections/changes shipped: ackable connection list, change feed with version transitions and contradictions. 113 web tests.
- **2026-11-06** — Export and permanent delete shipped: JSON brain bundle, `permanent=true` guard, `deletion_ops` audit, cascade delete, inspector download and two-step confirmation.
- **2026-11-06** — Inspector graph/score/profile shipped: deterministic graph, health meters with a 404 empty state, profile editing with validated directives.
- **2026-11-06** — Hardening: strict CSP for production/preview with a dev-only refresh allowance, and best-effort page embedding that cannot block an edit.
- **2026-11-06** — Inspector capture/edit shipped: note/URL capture with polling, page edit with 409 reload, contested resolve. Phase 2 gate closed.
- **2026-11-06** — Inspector shell shipped: Vite/React/Tailwind app with a typed API client, sessionStorage session, brains/pages/detail/search routes, safe markdown, and web typecheck/build in CI.
- **2026-11-06** — Phase 2 score/profile shipped: latest score snapshot, empty-default profile, partial profile upsert with a tenant guard.
- **2026-11-06** — Phase 2 graph shipped: live-only graph nodes and edges, similarity-ordered connections, idempotent connection ack.
- **2026-11-06** — Phase 2 changes shipped: change feed, idempotent ack, and page PATCH with version conflict, user version, change event and contested resolution.
- **2026-11-06** — Phase 2 read path shipped: pages list/get with `lastReferencedAt` bump, compact index, and hybrid FTS + pgvector search fused with RRF.
- **2026-11-06** — Page split shipped: batches over 6,000 characters become sibling pages with a `split` event; user-edited pages never split. Eval retries transient source failures. One run: 15% exact, F1 0.205, $0.083, 19/19 sources.
- **2026-11-06** — Patches batched per page: compile cost fell to $0.097 at real prices. Pricing defaults corrected in the eval and the worker ledger; rates are env-configurable.
- **2026-11-06** — Entity pages shipped: facts consolidate by entity, reviews resolve when one candidate shares an entity, and `pages.entities` is populated. Three runs: reviews 64→4, pages 22→3, exact 5%; $1.58/run at the old inflated default.
- **2026-11-06** — Routing instrumented: every PFS decision now carries best/second/gap/candidates, and the eval reports the distribution. Live: 34 place, 64 review, 19 new; the reviews are driven by near-duplicate pages, not the gap threshold.
- **2026-11-06** — Session dates ingested into the compiled text; live slice moved from 5% to 15% exact and 11.5% to 20.4% F1. Counts exposed 59 routing reviews against 22 pages — the next bottleneck.
- **2026-11-06** — First live eval recorded on a LoCoMo slice (conv-26, 20 questions, `openai/gpt-4.1-mini`): 5% exact, 11.5% F1, 554.5 injected tokens per question, $0.54 at the old inflated default. Temporal questions fail because session dates are not ingested.
- **2026-11-06** — Evidence spans re-anchored: a verbatim quote with wrong offsets is corrected instead of dropped; absent quotes still fail. This unblocked page compilation on real models.
- **2026-11-06** — Eval harness shipped: `tests/eval` compiles a labelled set through the real compiler, answers from a budgeted summaries index plus FTS pages, and reports exact match, F1, injected tokens, accuracy per 1k tokens, latency and cost. Fake mode is CI-safe; live mode is budget-gated.
- **2026-11-06** — `capture.compile` shipped: paragraph chunking to the store, extraction with evidence enforcement, MWS, PFS over pgvector candidates, patch/create paths, immutable versions, change events, embeddings, usage ledger, and source failure handling. 315 unit, 84 integration.
- **2026-11-06** — Two-tier storage shipped: migration `0008` (`body_ref`, `body_bytes`, nullable chunk text, `memory_settings` with RLS, budget caps), capture and worker write bodies through `@memtavi/storage`, and the wire exposes `contentPreview`, `contentUrl` and a signed content endpoint.
- **2026-11-06** — Storage live: private S3 + CloudFront with OAC, signed URLs, SSE-S3, lifecycle and least-privilege policies, deployed as `memtavi-storage-dev`. `@memtavi/storage` added with s3/local/fake drivers; 307 unit tests.
- **2026-11-06** — `p1-compiler-core` approved: plan-exact fact and patch contracts, evidence-span enforcement, MWS, PFS review band, patch decisions, versioned prompts, deterministic golden corpus; 239 unit tests.
- **2026-11-06** — `p1-llm` approved: provider interfaces, OpenRouter and OpenAI adapters, deterministic fake, typed error classification, and cost functions; 156 unit tests.
- **2026-11-06** — `p1-worker` approved: leased job claim with `SKIP LOCKED`, backoff and dead-lettering, and a document fetcher that resolves once and pins the connection to the validated address. 103 unit, 64 integration tests.
- **2026-11-06** — `p1-capture` approved: capture endpoints, source lifecycle, idempotent replay, `originRef` dedupe, job enqueue, and `ingest_sources.created_at` with a newest-first index; 53 integration tests.
- **2026-11-06** — Phase 0 complete. `p0-ci` approved: GitHub Actions `static` and `test` jobs, Postgres 18 with pgvector, migrations, and all three suites; both runs on `main` green.
- **2026-11-06** — `p0-auth` approved: API-key issuance and revocation with the role ladder, tenant/subject scope, error envelope, request id, and brains routes; 34 integration tests. Public repo published at `github.com/SwapnilSkr/memtavi`.
- **2026-11-06** — `p0-spec` approved: OpenAPI 3.1, 23 paths, 32 operations, 40 schemas, error envelope, pagination, idempotency, rate-limit headers, tenant/subject security split, and `spec:lint` with negative checks. Fern config for four generators.
- **2026-11-06** — `p0-db` approved: 28-table Drizzle schema, 6 migrations, full tenant RLS including the six child tables, partial slug uniqueness, weighted FTS and subject-scoped client; 64 isolation tests.
- **2026-11-06** — Local database moved to Homebrew `postgresql@18` on 5434 with brew-managed pgvector 0.8.7 (arm64). `memtavi_dev` and `memtavi_test` live there; the EDB 5432 and Homebrew 5433 clusters are untouched.
- **2026-11-06** — `p0-workspaces` approved: Bun workspace, strict tsconfig, Biome, `@memtavi/shared` with prefix IDs, five suite scripts, `.env.example` against local Postgres 18.
- **2026-11-06** — Codex usage found in its own rollouts (`rate_limits.primary`, 300 min). `lane_usage.py` now reads that snapshot, reset-aware, with tracker and manual fallbacks ordered by freshness. `fe` routes to grok above 70% used.
- **2026-11-06** — `agy` defaults to `gemini-3.8-flash-high`. Added `tools/lane_models.py`: per-account availability from `agy models`, cached 5 minutes, plus quota lookup. Argon (weekly-only pool) and Claude (separate group) are quota-gated fallbacks, never defaults.
- **2026-11-06** — Lane policy set: `cmd` is the backend workhorse, `grok` medium and load relief, `sol` boss-level plus frontend logic, `agy` UI only. Dispatcher and tiers updated.
- **2026-11-06** — Orchestration scaffold: `AGENTS.md`, 13 context nodes, `tools/{agent.sh,agent_guard.py,conventions_check.py,context_map.py}`, three Command Code subagents. Repo initialised.
