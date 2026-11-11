---
id: gl-changelog
when: recording or checking what shipped
holds: Shipped changes, newest first, dated
links: status
---

# Change log

Newest first. One line per shipped change: what, where, why. Not a commit log.

- **2026-11-11** — Inspector loop: brain rename/delete, capture retry/approve with backed-off polling (stops after 10 min idle), pages status filter (`/index` for the unfiltered list, since `listPages` must return bodies), version history and diff, new `/conflicts` (side-by-side claims, resolve with note) and `/reviews` (resolve onto a candidate or dismiss). Per-mutation invalidation map.

- **2026-11-11** — OpenTelemetry: off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Server span per request, a span per job attempt, a span per provider call; no bodies, keys, subject ids or prompt text. `jobs.trace_context` (migration 0016) is filled by trigger from `app.traceparent`, which `withTenant` sets, so a job joins the request trace. Request logs carry `traceId`. `docs/operations.md`.

- **2026-11-11** — Provider drills: `FakeProvider` queues `ProviderError`s for chat and embed; five drills (429, timeout, 5xx at embedding, malformed output, transient forever) prove retry, dead letter and nothing partial. Fixed: a source is `pending` during a queued transient retry and `failed` only when the job dies, so Retry cannot double-compile. `docs/operations.md`.

- **2026-11-11** — Retention: a source uncited for 90 days (clock kept by triggers on `page_sources`, fresh grace on backfill) loses its body, chunks text, previews and objects; keeps summary, hash and row. `retention.sweep` per tenant, 50 per batch, crash-safe deletion manifest. Migration 0015. Needs a storage stack update for prefix-scoped `s3:ListBucket`.

- **2026-11-11** — Memory modes enforced: `GET`/`PUT /v1/memory-settings` per subject (default `auto`, audited); `ask` holds captures (`awaitingApproval`) until `approveIngestSource`; `off` answers `202 stored:false` and writes nothing. REST, MCP `remember` and the client all respect it. Migration 0014.

- **2026-11-11** — Webhook events per PRD §8.4: `brain.change.new`, `brain.page.updated`, `brain.connection.new`, `brain.import.progress` are subscribable and delivered with typed signed payloads through a `webhook_events` outbox (migration 0013, trigger producers); raw-action subscriptions unchanged; overlap delivers once.

- **2026-11-11** — Connection discovery: every compile enqueues `connections.discover`; nearest 8 same-model pages above a 0.45 floor are judged in one `connect` v1 call (strong/medium/weak, noise dropped, one-line reasoning), canonically upserted; manual pairs untouched; no lock held across the model call. Connection webhooks wait on `p7-webhook-events`.

- **2026-11-11** — Routing reviews: `listRoutingReviews`, `resolveRoutingReview` (onto a candidate or a new page, applied by a `review.apply` job through the compile placement path, `routed` event) and `dismissRoutingReview`. Migration 0012 adds `created_at` and a list index.

- **2026-11-11** — Score history and suggestions: `getScoreHistory` (one point per UTC day over 7/30/90 days, plus delta) and `getScoreSuggestions` (deterministic rules in `@memtavi/core/health/suggestions`, `generatedBy: "rules"`).

- **2026-11-11** — `POST /pages/{slug}/resolve` (`resolvePage`): a contested page goes back to `active` with a note on an `updated` change event; an edited body writes a user version and re-embeds. `listPages` takes `status` (the contested queue). User page edits now fan out webhooks.

- **2026-11-11** — Page versions: `listPageVersions`, `getPageVersion` and `diffPageVersions` (line diff, 3 lines of context, `diff@9.0.0`, 5000-line cap). Reading versions never bumps `lastReferencedAt`.

- **2026-11-11** — `POST /sources/{sourceId}/retry` (`retryIngestSource`): a `failed` source goes back to `pending` with one recompile (or re-ingest when no body is stored), same source id, no extra storage usage; anything else is `409`. `attempts` counts manual retries.

- **2026-11-11** — Health scores: `packages/core/health/compute` (freshness, readiness, strain 0–100 with explaining factors, weights as constants), one aggregate metrics query in `@memtavi/db/health`, a `score.snapshot` job after every compile (one per brain per minute), and `GET /score` computes one on demand instead of `404`.

- **2026-11-11** — `GET /v1/members` (`listMembers`): admin keys list their tenant's members through a `SECURITY DEFINER` function scoped to `app.tenant_id` (migration 0011); the runtime still cannot read `users`. Every spec operation now has a route.

- **2026-11-11** — `DELETE /v1/brains/{brainId}` (`deleteBrain`): `202` receipt, brain hidden from every read and capture at once, `brain.purge` job deletes child rows then stored objects (crash-safe, idempotent), content-free tombstone keeps the `deletion_ops` record, slug reusable (partial unique index, migration 0010). Captures lock the brain, so none can land under a purge.

- **2026-11-11** — Phase 6 contract hardening (details in the archive and git history): `updateBrain`; spec statuses matched to routes; spec-generated HTTP isolation matrix; strict response validation over every operation; Fern-generated TS and Python SDKs with our own manifests, checked in CI.
