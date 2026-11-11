---
id: backlog
when: choosing the next slice, checking remaining product or hardening work
holds: Remaining product, hardening, deployment and deferred items, in priority order
links: status, gl-decisions
---

# Backlog

Ordered by product value per unit of risk. Remove items as they land.

## Phase 5, hardening

- **OTel**: traces across api → job → provider; JSON request logs already ship.
- **FTS under RLS**: the GIN index is unreachable because `ts_match_vq` is not leakproof; scans are sequential (`docs/benchmarks.md`).
- ~~Backup/restore rehearsal~~ (schema-only pass, 0.38 s RTO); still run it against the 10k-page shape for a real production RTO.
- ~~Contract diff~~ (`spec:compat`, baseline in `tests/contract`); response validation against the spec is still missing and `test:contract` remains a placeholder.
- **Provider failure drills**: rate limit, timeout, malformed output; assert retries and no partial pages.

## Product gaps

- **Webhook event types**: PRD §8.4 names (`brain.connection.new` etc.) are not subscribable or deliverable; brief `p7-webhook-events`.
- **Memory modes**: `memory_settings` exists but is unenforced. Wire `auto`/`ask`/`off` into capture and `remember`.
- **Retention**: sources and chunks never expire; add the citation-aware 90-day body drop.
- **Webhooks UI**: API and CLI exist; the inspector has no webhooks screen.
- **Inspector read cost**: the pages table fetches full bodies; switch to `/index` and add pagination.
- **Eval quality**: 15% exact / 0.205 F1 on a 20-question slice, 37 reviews; run full LoCoMo before tuning prompts.

- **Missing v1 endpoints**: profile suggestions.
- **SDK publishing**: npm and PyPI accounts, licence; then optionally rebase the CLI/MCP on `@memtavi/sdk`.

## Deployment

- API and worker are not hosted; only S3 and CloudFront exist.
- Custom domain + ACM certificate for CloudFront (TLS 1.2 minimum).
- CloudFront standard logging v2, AWS Budget alarm.
- Attach `memtavi-storage-*` policies to task roles; stop using the root CLI identity.
- Choose a hosting shape: single VPS + systemd, Fly/Render, or ECS/Fargate.

## Deferred by decision

- **OAuth connector**: blocked on human login; do not fake a consent flow.
- **Phase 6 extras**: daily briefs, Slack, Telegram, MCP Apps, audio transcription.
