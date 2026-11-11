---
id: backlog
when: choosing the next slice, checking remaining product or hardening work
holds: Remaining product, hardening, deployment and deferred items, in priority order
links: status, gl-decisions
---

# Backlog

Ordered by product value per unit of risk. Remove items as they land.

## Phase 5, hardening

- **FTS under RLS**: the GIN index is unreachable because `ts_match_vq` is not leakproof; scans are sequential (`docs/benchmarks.md`).
- ~~Backup/restore rehearsal~~ (schema-only pass, 0.38 s RTO); still run it against the 10k-page shape for a real production RTO.

## Product gaps

- **Inspector presentation**: screens use plain accessible markup; one UI pass for layout, hierarchy and mobile (390 px) across all 14 screens.

- **Eval quality**: 15% exact / 0.205 F1 on a 20-question slice, 37 reviews; run full LoCoMo before tuning prompts.

- **SDK publishing**: npm and PyPI accounts, licence; then optionally rebase the CLI/MCP on `@memtavi/sdk`.

## Deployment

- API and worker are not hosted; only S3 and CloudFront exist.
- Custom domain + ACM certificate for CloudFront (TLS 1.2 minimum).
- CloudFront standard logging v2, AWS Budget alarm.
- Update the storage stack (worker `s3:ListBucket` on source prefixes, for retention).
- Attach `memtavi-storage-*` policies to task roles; stop using the root CLI identity.
- Choose a hosting shape: single VPS + systemd, Fly/Render, or ECS/Fargate.

## Deferred by decision

- **OAuth connector**: blocked on human login; do not fake a consent flow.
- **Phase 6 extras**: daily briefs, Slack, Telegram, MCP Apps, audio transcription.
