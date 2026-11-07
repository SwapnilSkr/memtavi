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
- **Next:** `p0-ci` (cmd) — GitHub Actions for typecheck, lint, spec lint, unit, isolation and integration against a Postgres service. That closes Phase 0.
