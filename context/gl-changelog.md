---
id: gl-changelog
when: recording or checking what shipped
holds: Shipped changes, newest first, dated
links: status
---

# Change log

Newest first. One line per shipped change: what, where, why. Not a commit log.

- **2026-11-11** — `GET /v1/members` (`listMembers`): admin keys list their tenant's members through a `SECURITY DEFINER` function scoped to `app.tenant_id` (migration 0011); the runtime still cannot read `users`. Every spec operation now has a route.

- **2026-11-11** — `DELETE /v1/brains/{brainId}` (`deleteBrain`): `202` receipt, brain hidden from every read and capture at once, `brain.purge` job deletes child rows then stored objects (crash-safe, idempotent), content-free tombstone keeps the `deletion_ops` record, slug reusable (partial unique index, migration 0010). Captures lock the brain, so none can land under a purge.

- **2026-11-11** — `PATCH /v1/brains/{brainId}` (`updateBrain`): partial update, developer role, tenant-checked `projectId`, `null` clears it, empty body writes nothing. Contract and isolation suites cover it with no exemption.

- **2026-11-11** — Spec statuses match the routes: `400` documented on 13 operations, `403` on `updateBrain`/`deleteBrain`/`listMembers`, 13 never-raised `422`/`409`/`404` removed (baseline updated; no client could receive them). `createWebhook` keeps its real `422`. SDKs regenerated.

- **2026-11-11** — HTTP isolation matrix: spec-generated foreign-tenant, foreign-subject, foreign-child and tenant-scoped probes on every routed operation, list leak scans, and auth negatives; a catalog-driven snapshot proves all 27 tenant-scoped tables unchanged. Zero leaks. 78 isolation tests.

- **2026-11-11** — Response validation: `test:contract` drives all 33 operations through the app on the test DB, validates status, `x-request-id` and bodies in strict mode (undocumented fields fail), and a two-sided coverage guard fails on any untested documented status. Shared harness in `tests/support`. Found 3 spec-only operations (`updateBrain`, `deleteBrain`, `listMembers`) with no route. 550 unit tests.

- **2026-11-11** — SDKs: Fern cloud generates `@memtavi/sdk` (TS, ESM, zero deps) and `memtavi` (Python) into `sdks/`; manifests are ours because Fern gates package metadata by plan. `sdk:check` (spec hash + README) and `test:sdk` (offline smoke, both languages) in CI; generation verified deterministic. 544 unit tests.

- **2026-11-06** — Contract compatibility diff: 3.1-aware baseline in `tests/contract`, `spec:compat` in CI, breaking changes fail with a JSON Pointer. 538 tests.
- **2026-11-06** — Backup/restore rehearsal: custom dump and restore with zero mismatches, RLS smoke pass, 0.38 s RTO on a schema-only DB; production-sized rerun pending.
- **2026-11-06** — 10k search benchmark: FTS p95 5–9 ms, vector p95 43–46 ms under RLS; documented in `docs/benchmarks.md`. Finding: the FTS GIN index is unreachable under RLS because `ts_match_vq` is not leakproof.
- **2026-11-06** — Guardrails: per-key rate limiting with 429/`Retry-After` and rate headers, Redis-free fixed windows, JSON request logs with no secrets, worker logger. 185 integration, 522 unit.
- **2026-11-06** — Budget caps enforced: `usage_ledger.created_at`, monthly spend check before every provider call, seeded `$20` hard cap, zero calls on breach. 182 integration tests.
- **2026-11-06** — Fern: login completed, generators upgraded to TS 3.108.9 / Python 4.64.1, Colima local generation tested and the VM reclaimed. Local output is source-only (no package manifests), so the SDK item remains open.
- **2026-11-06** — Fern login completed; generator config fixed and unavailable CLI/MCP groups removed. Generation is blocked by the generator runtime's npm `EACCES`, so no partial SDK artifacts were kept.
- **2026-11-06** — Webhook delivery shipped: SSRF-safe POST, HMAC signatures, delivery records, retries and one delivery per matching webhook per change event. 175 integration, 517 unit.
- **2026-11-06** — Webhook registration shipped: encrypted write-once secrets, validated events, client and CLI commands. 167 integration, 509 unit tests.
- **2026-11-06** — Generated API reference: `docs/API.md` from the OpenAPI spec with a CI stale check.
- **2026-11-06** — Shared client and CLI shipped: `@memtavi/client` with all 20 operations, MCP rebased onto it, and `memtavi` CLI with 19 commands, `--json`, brain resolution and 0/1/2 exit codes. 106 package tests.
- **2026-11-06** — MCP write surface shipped: `remember` with deterministic idempotency and async semantics, plus `source_status`. Six tools, no transcript tool. 68 package tests.
- **2026-11-06** — MCP read-only server shipped: stdio server with `list_brains`, `index`, `search`, `read`, API-key auth, brain resolution and stderr-only diagnostics. 46 package tests.
- **2026-11-06** — Inspector connections/changes shipped: ackable connection list, change feed with version transitions and contradictions. 113 web tests.
- **2026-11-06** — Export and permanent delete shipped: JSON brain bundle, `permanent=true` guard, `deletion_ops` audit, cascade delete, inspector download and two-step confirmation.
