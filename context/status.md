---
id: status
when: resuming work, deciding what to do next
holds: The short list of work in flight, each pointing at its node
links: agents-lanes, gl-changelog
---

# Status

Last updated 2026-11-06. One line per open item; detail lives in the linked node.

- **Orchestration scaffolded** (2026-11-06): `AGENTS.md`, 14 context nodes, `tools/` guard, four lanes plus the `fe` router. `agy` defaults to Gemini 3.8 Flash with quota-gated, account-checked Argon/Claude fallbacks; heavy FE diverts to grok once Codex's 5-hour usage passes 70%, read from Codex's own rollout snapshots. Node budgets enforced by `tools/context_map.py --check`.
- **`p0-workspaces` approved** (2026-11-06): Bun workspace, strict tsconfig, Biome, `@memtavi/shared` prefix IDs, five suite scripts green. Database is Homebrew PostgreSQL 18 on 5434 with brew-managed pgvector 0.8.7 (native arm64), role `memtavi`, databases `memtavi_dev` and `memtavi_test`. The EDB server on 5432 is untouched. No Docker, no MinIO. Review: `.agents/reviews/p0-workspaces-r1.md`.
- **`p0-db` approved** (2026-11-06): 28 application tables, 6 migrations, 26 RLS policies, 64 isolation tests green. Child tables carry `tenant_id`; `users`/`tenants` are closed to the runtime role; arrays, slug uniqueness, weighted FTS and subject scope are correct. Review: `.agents/reviews/p0-db-r2.md`.
- **`p0-spec` approved** (2026-11-06): OpenAPI 3.1 with 23 paths, 32 operations, 40 schemas; fixed error envelope, offset pagination, idempotency, 429 `Retry-After`, 404-for-other-tenant, and tenant routes split from subject routes in the security scheme. `spec:lint` enforces the rules. Fern declares all four generators. Review: `.agents/reviews/p0-spec-r2.md`.
- **`p0-auth` approved** (2026-11-06): API keys (`mtv_live_`, SHA-256, shown once), role ladder enforced on creation and revocation, subject validation, tenant-scoped transactions, error envelope, request id, and brains create/list/get. 34 integration tests; the Phase 0 gate (tenant A creates, tenant B gets 404) is proven. Review: `.agents/reviews/p0-auth-r2.md`.
- **Phase 0 complete** (2026-11-06): `p0-workspaces`, `p0-db`, `p0-spec`, `p0-auth` and `p0-ci` are approved. CI runs `static` and `test` on every push and PR: typecheck, lint, spec lint, migrations on two databases, unit, isolation and integration against `pgvector/pgvector:pg18`. Both runs on `main` are green. Repo: `github.com/SwapnilSkr/memtavi`.
- **`p1-capture` approved** (2026-11-06): capture and source endpoints with content/URL XOR, 50k cap, `originRef` and `Idempotency-Key` dedupe, one `capture.ingest` job per source, soft delete, and newest-first listing backed by a new `created_at` column and index. 53 integration tests. Review: `.agents/reviews/p1-capture-r2.md`.
- **`p1-worker` approved** (2026-11-06): job claim with `SKIP LOCKED` and leases, backoff and dead-lettering, plus the SSRF fetcher that resolves once and pins the connection to the validated address. 103 unit and 64 integration tests. Review: `.agents/reviews/p1-worker-r2.md`.
- **`p1-llm` approved** (2026-11-06): chat and embedding interfaces, OpenRouter and OpenAI adapters with transient/permanent classification, a deterministic fake, and cost accounting at the plan's prices. 156 unit tests. Review: `.agents/reviews/p1-llm-r1.md`.
- **`p1-compiler-core` approved** (2026-11-06): Zod fact/patch contracts matching the plan, extraction with evidence-span enforcement, MWS banding, PFS place/review/new, patch contested/append/rewrite rules, versioned prompts, and a deterministic golden corpus. 239 unit tests. Review: `.agents/reviews/p1-compiler-core-r2.md`.
- **Storage infrastructure live** (2026-11-06): `memtavi-storage-dev` CloudFormation stack in `ap-south-1` — private bucket `memtavi-media-dev-209479287671`, CloudFront `E22V6MKMFVBZ8C` with OAC and signed URLs, SSM-held signing key, IAM policies, lifecycle. Unsigned requests return 403; signed return 200.
- **`p1-storage` approved**: `@memtavi/storage` with `s3`, `local` and `fake` drivers, content-addressed key builders and signed URLs. 307 unit tests. Review: `.agents/reviews/p1-storage-r1.md`.
- **Open AWS follow-ups** (2026-11-06, none blocking Phase 1):
  - **TLS 1.2**: the default `*.cloudfront.net` certificate forces a TLSv1 minimum. Set `CertificateArn` (ACM, us-east-1) and `AliasDomain` on the stack to switch to `sni-only` + `TLSv1.2_2021`. Needs a domain.
  - **Retention**: `sources/` and `chunks/` have no lifecycle expiration by design; ship the citation-aware `storage-retention` job before launch. Do not add a blind lifecycle rule — it would delete evidence pages cite.
  - **Budget guard**: create an AWS Budget at $5/month with an email alert. Not created yet.
  - **Dev CORS**: add `http://localhost:5173` to `AllowedOrigin` before inspector work, or signed media fetches from the browser will fail.
  - **Cache header**: set `Cache-Control: public, max-age=31536000, immutable` on put in `packages/storage`; keys never change.
  - **Task roles**: attach `memtavi-storage-worker-dev` and `memtavi-storage-api-dev` to ECS/EC2 roles. The local CLI is authenticated as root and must never back an app process.
- **`p1-storage-db` approved**: migration `0008` adds `body_ref`/`body_bytes`, nullable chunk text, the `memory_mode` enum, `memory_settings` with RLS and a grant, and the three budget caps. 72 isolation tests. Review: `.agents/reviews/p1-storage-db-r1.md`.
- **`p1-storage-wire` approved**: capture writes inline bodies to the object store and keeps a 4,000-character preview; the worker stores fetched text the same way; `contentPreview`, `contentUrl` and the content endpoint are on the wire; spec and API moved together. 69 integration tests. Review: `.agents/reviews/p1-storage-wire-r1.md`.
- **`p1-compiler-wire` approved**: `capture.compile` chunks into the store, extracts with evidence enforcement, gates on MWS, routes with PFS over pgvector candidates, patches or creates pages, writes immutable versions, change events, embeddings and usage, and marks the source completed. 315 unit and 84 integration tests. Review: `.agents/reviews/p1-compiler-wire-r1.md`.
- **`p1-eval` approved**: `tests/eval` compiles a labelled conversation set through the real compiler, answers from a summaries-only index plus three FTS pages, and reports exact match, F1, injected tokens, accuracy per 1k tokens, latency and cost. Fake mode is a labelled plumbing check; live mode requires keys and `EVAL_BUDGET_USD` and refuses non-test databases. Review: `.agents/reviews/p1-eval-r1.md`.
- **Live result after date ingestion** (conv-26, 20 questions): **15% exact, 20.4% F1**, 1,518 injected tokens per question, p50 1.1 s, $0.81. Temporal exact went from 0/12 to 2/12. Compiler built 22 pages, 64 versions, 59 routing reviews, 19/19 sources completed.
- **Routing measured** (117 facts): 34 place, 64 review, 19 new. Best score median 0.563; 64 of 81 facts above 0.45 have a gap below 0.15. The review band is behaving as coded — the candidate set is full of near-duplicate pages because the first 19 facts each created a page. **Page granularity is the bug, not the 0.15 threshold.**
- **Single-run accuracy is noisy**: 15% then 10% on identical inputs (19 vs 22 pages, 64 vs 59 reviews). Report a mean across at least three runs before claiming a threshold effect.
- **Next: `p1-page-granularity`** — consolidate new pages by entity or topic instead of one page per fact, add a review resolution path, then rerun the slice three times and compare means.
- **Evidence anchor fix shipped**: the first live run exposed that models return exact quotes with wrong character offsets, so every fact was dropped. `extractFacts` now re-anchors a verbatim quote and drops only text that is absent. Without it, zero pages compiled.
- **Phase 1 complete**: capture, storage, worker, LLM, compiler core, compiler wire, eval harness and the first live measurement are recorded.
