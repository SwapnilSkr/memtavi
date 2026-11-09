---
id: gl-changelog
when: recording or checking what shipped
holds: Shipped changes, newest first, dated
links: status
---

# Change log

Newest first. One line per shipped change: what, where, why. Not a commit log.

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
