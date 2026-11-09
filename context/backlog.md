---
id: backlog
when: choosing the next slice, checking remaining product or hardening work
holds: Remaining product, hardening, deployment and deferred items, in priority order
links: status, gl-decisions
---

# Backlog

Ordered by product value per unit of risk. Remove items as they land.

## Phase 5, hardening

- **Budget caps (next)**: enforce the monthly cap from `usage_ledger` before every provider call; seed a default row per tenant.
- **Rate limiting**: per-key limits with `429` and `Retry-After`; the plan's defaults are 300/min API and 120/min MCP.
- **Structured logging + OTel**: request and job ids, tenant, route, duration; never bodies, prompts or keys.
- **10k benchmark**: seed 10k pages, measure FTS and vector p50/p95, wire `bench:search`.
- ~~Backup/restore rehearsal~~ (schema-only pass, 0.38 s RTO); still run it against the 10k-page shape for a real production RTO.
- ~~Contract diff~~ (`spec:compat`, baseline in `tests/contract`); response validation against the spec is still missing and `test:contract` remains a placeholder.
- **Isolation endpoint matrix**: every route with a foreign brain/page/source/change/connection id and a foreign subject.
- **Provider failure drills**: rate limit, timeout, malformed output; assert retries and no partial pages.

## Product gaps

- **Health score**: nothing writes `score_snapshots`, so `/score` is always 404. Compute freshness/readiness/strain after compiles and persist snapshots.
- **Connection discovery + CRS**: `connections` is empty in practice; add the post-compile LLM-judged connection step with strength, reasoning and ack.
- **Memory modes**: `memory_settings` exists but is unenforced. Wire `auto`/`ask`/`off` into capture and `remember`.
- **Retention**: sources and chunks never expire; add the citation-aware 90-day body drop.
- **Webhooks UI**: API and CLI exist; the inspector has no webhooks screen.
- **Inspector read cost**: the pages table fetches full bodies; switch to `/index` and add pagination.
- **Eval quality**: 15% exact / 0.205 F1 on a 20-question slice, 37 reviews; run full LoCoMo before tuning prompts.

## Deployment

- API and worker are not hosted; only S3 and CloudFront exist.
- Custom domain + ACM certificate for CloudFront (TLS 1.2 minimum).
- CloudFront standard logging v2, AWS Budget alarm.
- Attach `memtavi-storage-*` policies to task roles; stop using the root CLI identity.
- Choose a hosting shape: single VPS + systemd, Fly/Render, or ECS/Fargate.

## Deferred by decision

- **OAuth connector**: blocked on human login; do not fake a consent flow.
- **Fern SDKs**: generator emits source without manifests; revisit only if packaging is fixed.
- **Phase 6 extras**: daily briefs, Slack, Telegram, MCP Apps, audio transcription.
