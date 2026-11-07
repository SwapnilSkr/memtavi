---
id: gl-changelog
when: recording or checking what shipped
holds: Shipped changes, newest first, dated
links: status
---

# Change log

Newest first. One line per shipped change: what, where, why. Not a commit log.

- **2026-11-06** — `p0-spec` approved: OpenAPI 3.1, 23 paths, 32 operations, 40 schemas, error envelope, pagination, idempotency, rate-limit headers, tenant/subject security split, and `spec:lint` with negative checks. Fern config for four generators.
- **2026-11-06** — `p0-db` approved: 28-table Drizzle schema, 6 migrations, full tenant RLS including the six child tables, partial slug uniqueness, weighted FTS and subject-scoped client; 64 isolation tests.
- **2026-11-06** — Local database moved to Homebrew `postgresql@18` on 5434 with brew-managed pgvector 0.8.7 (arm64). `memtavi_dev` and `memtavi_test` live there; the EDB 5432 and Homebrew 5433 clusters are untouched.
- **2026-11-06** — `p0-workspaces` approved: Bun workspace, strict tsconfig, Biome, `@memtavi/shared` with prefix IDs, five suite scripts, `.env.example` against local Postgres 18.
- **2026-11-06** — Codex usage found in its own rollouts (`rate_limits.primary`, 300 min). `lane_usage.py` now reads that snapshot, reset-aware, with tracker and manual fallbacks ordered by freshness. `fe` routes to grok above 70% used.
- **2026-11-06** — `agy` defaults to `gemini-3.8-flash-high`. Added `tools/lane_models.py`: per-account availability from `agy models`, cached 5 minutes, plus quota lookup. Argon (weekly-only pool) and Claude (separate group) are quota-gated fallbacks, never defaults.
- **2026-11-06** — Lane policy set: `cmd` is the backend workhorse, `grok` medium and load relief, `sol` boss-level plus frontend logic, `agy` UI only. Dispatcher and tiers updated.
- **2026-11-06** — Orchestration scaffold: `AGENTS.md`, 13 context nodes, `tools/{agent.sh,agent_guard.py,conventions_check.py,context_map.py}`, three Command Code subagents. Repo initialised.
