---
id: status
when: resuming work, deciding what to do next
holds: What is complete, what is blocked, and the next slice
links: backlog, gl-changelog
---

# Status

Last updated 2026-11-06.

## Complete

- **Phase 1**: capture, storage, worker, LLM, compiler core and wire, eval harness.
- **Phase 2/3**: full read path, changes, graph, score/profile, inspector capture → read → correct, connections/changes screens, export, permanent delete, webhooks, MCP and CLI.
- **Storage**: private S3 + CloudFront OAC with signed URLs; bodies in S3, knowledge in Postgres.
- **Compiler**: chunk → extract → MWS → PFS → patch/split → versions/embeddings; batched patches; entity pages; evidence re-anchor.
- **Surfaces**: MCP (6 tools), shared client (20 ops), CLI (incl. webhooks), inspector (9 screens), generated API docs.
- **Tests**: 517 unit, 175 integration, 72 isolation, 113 web. CI green.

## Blocked or deferred

- **OAuth connector**: needs a human login route (sessions/OIDC); not faked.
- **Fern SDKs**: generator emits source without manifests; hand-written surfaces stand.
- **Deployment**: API and worker are not hosted; custom domain/TLS, CloudFront logs and a budget alarm are pending.

## Now

- **Backup/restore rehearsal passes**: custom dump, restore into a scratch DB, 0 mismatches across 30 tables, 9 migrations, 27 RLS tables/policies and 106 grants; tenant isolation passes as `memtavi_app`. RTO 0.38 s on the schema-only 108 KiB test DB; a production-sized rerun is still pending.
- **Next**: contract diff (`tests/contract` is empty), then the endpoint isolation matrix and provider-failure drills.

Full list: [backlog](./backlog.md).
