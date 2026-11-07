---
id: status
when: resuming work, deciding what to do next
holds: The short list of work in flight, each pointing at its node
links: agents-lanes, gl-changelog
---

# Status

Last updated 2026-11-06. One line per open item; detail lives in the linked node.

- **Orchestration scaffolded** (2026-11-06): `AGENTS.md`, 14 context nodes, `tools/` guard, four lanes plus the `fe` router. `agy` defaults to Gemini 3.8 Flash with quota-gated, account-checked Argon/Claude fallbacks; heavy FE diverts to grok once Codex's 5-hour usage passes 70%, read from Codex's own rollout snapshots. Node budgets enforced by `tools/context_map.py --check`.
- **`p0-workspaces` approved** (2026-11-06): Bun workspace, strict tsconfig, Biome, `@memtavi/shared` prefix IDs, five suite scripts green. Database is Homebrew PostgreSQL 18 on 5434 with brew-managed pgvector 0.8.7 (native arm64), role `memtavi`, databases `memtavi_dev` and `memtavi_test`. The EDB server on 5432 is untouched. No Docker, no MinIO. Review: `.agents/reviews/p0-workspaces-r1.md`.
- **`p0-db` approved** (2026-11-06): 28 application tables, 6 migrations, 26 RLS policies, 64 isolation tests green. Child tables carry `tenant_id`; `users`/`tenants` are closed to the runtime role; arrays, slug uniqueness, weighted FTS and subject scope are correct. Review: `.agents/reviews/p0-db-r2.md`.
- **`p0-spec` approved** (2026-11-06): OpenAPI 3.1 with 23 paths, 32 operations, 40 schemas; fixed error envelope, offset pagination, idempotency, 429 `Retry-After`, 404-for-other-tenant, and tenant routes split from subject routes in the security scheme. `spec:lint` enforces the rules. Fern declares all four generators. Review: `.agents/reviews/p0-spec-r2.md`.
- **`p0-auth` approved** (2026-11-06): API keys (`mtv_live_`, SHA-256, shown once), role ladder enforced on creation and revocation, subject validation, tenant-scoped transactions, error envelope, request id, and brains create/list/get. 34 integration tests; the Phase 0 gate (tenant A creates, tenant B gets 404) is proven. Review: `.agents/reviews/p0-auth-r2.md`.
- **Phase 0 complete** (2026-11-06): `p0-workspaces`, `p0-db`, `p0-spec`, `p0-auth` and `p0-ci` are approved. CI runs `static` and `test` on every push and PR: typecheck, lint, spec lint, migrations on two databases, unit, isolation and integration against `pgvector/pgvector:pg18`. Both runs on `main` are green. Repo: `github.com/SwapnilSkr/memtavi`.
- **`p1-capture` approved** (2026-11-06): capture and source endpoints with content/URL XOR, 50k cap, `originRef` and `Idempotency-Key` dedupe, one `capture.ingest` job per source, soft delete, and newest-first listing backed by a new `created_at` column and index. 53 integration tests. Review: `.agents/reviews/p1-capture-r2.md`.
- **`p1-worker` approved** (2026-11-06): job claim with `SKIP LOCKED` and leases, backoff and dead-lettering, plus the SSRF fetcher that resolves once and pins the connection to the validated address. 103 unit and 64 integration tests. Review: `.agents/reviews/p1-worker-r2.md`.
- **`p1-llm` approved** (2026-11-06): chat and embedding interfaces, OpenRouter and OpenAI adapters with transient/permanent classification, a deterministic fake, and cost accounting at the plan's prices. 156 unit tests. Review: `.agents/reviews/p1-llm-r1.md`.
- **Next: `p1-compiler-core`** (sol) — Zod contracts, extraction prompt and validation, MWS and PFS policies with the review band, patch rules, and a golden-corpus test on the fake provider.
