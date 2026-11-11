---
id: status
when: resuming work, deciding what to do next
holds: What is complete, what is blocked, and the next slice
links: backlog, gl-changelog
---

# Status

Last updated 2026-11-11.

## Complete

- **Phase 1–3**: capture, storage, worker, compiler, full read path, changes, graph, connections discovery, health scores with history and suggestions, profile with model suggestions, contested resolve, routing reviews, page versions and diff, memory modes, retention, export, brain update and delete, members, webhooks with PRD event names.
- **Surfaces**: 47 spec operations, all routed; MCP (6 tools), CLI, inspector (14 screens, design pass done, checked at 390/1440 px), Fern TS and Python SDKs (unpublished).
- **Phase 5**: keyword search on its GIN index under RLS, budget caps, rate limits, request logs with trace ids, OpenTelemetry (off by default), provider failure drills, 10k search benchmark, backup/restore rehearsal, spec compat gate, strict response validation, HTTP isolation matrix.
- **Tests**: 660 unit, 370 integration, 88 isolation, 18 contract, 308 web, 7 SDK smoke. CI green.

## Blocked on the owner

- **SDK publishing**: npm/PyPI accounts and a licence.
- **Deployment**: API and worker are not hosted; storage stack needs an update (worker `s3:ListBucket` for retention); domain/TLS, logs, budget alarm.
- **OAuth connector**: needs a human login route.

## Now

- v1 product scope is shipped (PRs 3–25). Remaining engineering: a full LoCoMo eval (needs a model-spend budget) before any prompt tuning.
- `gh` active account may differ from the repo owner; push with the owner's token.

Full list: [backlog](./backlog.md).
