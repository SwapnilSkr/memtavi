---
id: gl-changelog
when: recording or checking what shipped
holds: Shipped changes, newest first, dated
links: status
---

# Change log

Newest first. One line per shipped change: what, where, why. Not a commit log.

- **2026-11-11** — Score history and suggestions: `getScoreHistory` (one point per UTC day over 7/30/90 days, plus delta) and `getScoreSuggestions` (deterministic rules in `@memtavi/core/health/suggestions`, `generatedBy: "rules"`).

- **2026-11-11** — `POST /pages/{slug}/resolve` (`resolvePage`): a contested page goes back to `active` with a note on an `updated` change event; an edited body writes a user version and re-embeds. `listPages` takes `status` (the contested queue). User page edits now fan out webhooks.

- **2026-11-11** — Page versions: `listPageVersions`, `getPageVersion` and `diffPageVersions` (line diff, 3 lines of context, `diff@9.0.0`, 5000-line cap). Reading versions never bumps `lastReferencedAt`.

- **2026-11-11** — `POST /sources/{sourceId}/retry` (`retryIngestSource`): a `failed` source goes back to `pending` with one recompile (or re-ingest when no body is stored), same source id, no extra storage usage; anything else is `409`. `attempts` counts manual retries.

- **2026-11-11** — Health scores: `packages/core/health/compute` (freshness, readiness, strain 0–100 with explaining factors, weights as constants), one aggregate metrics query in `@memtavi/db/health`, a `score.snapshot` job after every compile (one per brain per minute), and `GET /score` computes one on demand instead of `404`.

- **2026-11-11** — `GET /v1/members` (`listMembers`): admin keys list their tenant's members through a `SECURITY DEFINER` function scoped to `app.tenant_id` (migration 0011); the runtime still cannot read `users`. Every spec operation now has a route.

- **2026-11-11** — `DELETE /v1/brains/{brainId}` (`deleteBrain`): `202` receipt, brain hidden from every read and capture at once, `brain.purge` job deletes child rows then stored objects (crash-safe, idempotent), content-free tombstone keeps the `deletion_ops` record, slug reusable (partial unique index, migration 0010). Captures lock the brain, so none can land under a purge.

- **2026-11-11** — `PATCH /v1/brains/{brainId}` (`updateBrain`): partial update, developer role, tenant-checked `projectId`, `null` clears it, empty body writes nothing. Contract and isolation suites cover it with no exemption.

- **2026-11-11** — Spec statuses match the routes: `400` documented on 13 operations, `403` on `updateBrain`/`deleteBrain`/`listMembers`, 13 never-raised `422`/`409`/`404` removed (baseline updated; no client could receive them). `createWebhook` keeps its real `422`. SDKs regenerated.

- **2026-11-11** — HTTP isolation matrix: spec-generated foreign-tenant, foreign-subject, foreign-child and tenant-scoped probes on every routed operation, list leak scans, and auth negatives; a catalog-driven snapshot proves all 27 tenant-scoped tables unchanged. Zero leaks. 78 isolation tests.

- **2026-11-11** — Response validation: `test:contract` drives all 33 operations through the app on the test DB, validates status, `x-request-id` and bodies in strict mode (undocumented fields fail), and a two-sided coverage guard fails on any untested documented status. Shared harness in `tests/support`. Found 3 spec-only operations (`updateBrain`, `deleteBrain`, `listMembers`) with no route. 550 unit tests.

- **2026-11-11** — SDKs: Fern cloud generates `@memtavi/sdk` (TS, ESM, zero deps) and `memtavi` (Python) into `sdks/`; manifests are ours because Fern gates package metadata by plan. `sdk:check` (spec hash + README) and `test:sdk` (offline smoke, both languages) in CI; generation verified deterministic. 544 unit tests.
