---
id: gl-changelog
when: recording or checking what shipped
holds: Shipped changes, newest first, dated
links: status
---

# Change log

Newest first. One line per shipped change: what, where, why. Not a commit log.

- **2026-11-11** — Health factor tone reflects the current effect: `neutral` at 0, otherwise `positive` for raising factors and `negative` for lowering ones. Scores unchanged.

- **2026-11-11** — Inspector design pass: grouped sidebar (menu disclosure on phones), text-bearing status badges, compact page cards under 768 px, body-first page detail with a metadata aside, `lib/format` dates, a consistent card/button system across all 14 screens. No horizontal scroll at 390 px. Presentation only.

- **2026-11-11** — Keyword search reaches its GIN index under RLS: `search_pages_keyword` (migration 0017), a definer function repeating the `tenant_isolation` predicate plus the transaction subject. One index scan per query; RLS unchanged.

- **2026-11-11** — Inspector settings: health on 0–100 (was clamped to 0–1) with factors, 30-day trend and linked suggestions; profile suggestions on demand with one-click apply; `/settings` with API keys and webhooks (secret shown once, never cached), members, memory mode, export and deletion progress; pages list pages through `getIndex`.

- **2026-11-11** — `POST /profile/suggestions` (`suggestProfile`, developer): prompt v1 over the top 40 index entries plus the current profile, no bodies; fewer than 3 pages returns `[]` with no call. Drops unknown fields, unchanged values and slugs not in the input. Shared `budgetExceeded` policy with the worker, usage recorded once against a completed `profile.suggest` job. `503` (+`Retry-After`) when unconfigured or the provider is transiently down, `502` on a permanent provider error. Never auto-applied.

- **2026-11-11** — `getIndex` pages (`offset`), filters (`status`) and returns each entry's `status` (optional in the spec, so 0 breaking); `total` counts the filtered set. SDKs regenerated.

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

- **2026-11-11** — Earlier Phase 3 and 6 work (details in git history): source retry, health scores, `deleteBrain` with async purge and tombstone, `listMembers`, and the contract hardening (`updateBrain`, spec statuses, isolation matrix, strict response validation, Fern SDKs).
