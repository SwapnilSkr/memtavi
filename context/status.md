---
id: status
when: resuming work, deciding what to do next
holds: What is complete, what is blocked, and the next slice
links: backlog, gl-changelog
---

# Status

Last updated 2026-11-11.

## Complete

- **Phase 1**: capture, storage, worker, LLM, compiler core and wire, eval harness.
- **Phase 2/3**: full read path, changes, graph, score/profile, inspector capture → read → correct, connections/changes screens, export, permanent delete, webhooks, MCP and CLI.
- **Storage**: private S3 + CloudFront OAC with signed URLs; bodies in S3, knowledge in Postgres.
- **Compiler**: chunk → extract → MWS → PFS → patch/split → versions/embeddings; batched patches; entity pages; evidence re-anchor.
- **Surfaces**: MCP (6 tools), shared client (20 ops), CLI (incl. webhooks), inspector (9 screens), generated API docs, Fern-generated TS and Python SDKs (all 33 ops, unpublished).
- **Phase 5 so far**: budget caps, rate limiting + request logs, 10k search benchmark, backup/restore rehearsal, contract diff.
- **Tests**: 550 unit, 185 integration, 78 isolation, 9 contract, 113 web, 6 SDK smoke. CI green.

## Blocked or deferred

- **OAuth connector**: needs a human login route (sessions/OIDC); not faked.
- **SDK publishing**: `@memtavi/sdk` and `memtavi` build; npm/PyPI accounts and a licence are owner decisions.
- **Deployment**: API and worker are not hosted; custom domain/TLS, CloudFront logs and a budget alarm are pending.

## Now

- **SDKs shipped** (2026-11-11): Fern cloud generates source; we own the manifests; `sdk:check` and `test:sdk` in CI. See `docs/sdks.md`.
- **Response validation shipped** (2026-11-11): `test:contract` covers every operation in strict mode.
- **Isolation matrix shipped** (2026-11-11): every routed operation probed with foreign ids; zero leaks. Phase 5 isolation gate met for routed operations.
- **Next**: reconcile the spec with the routes (3 spec-only operations, undocumented `400`s), then provider-failure drills and OTel.

Full list: [backlog](./backlog.md).
