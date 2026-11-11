---
id: gl-decisions
when: checking or recording a decision
holds: Accepted decisions, newest last, dated
links: status
---

# Decisions

Append only. Absolute dates. A decision names what changed and what it rules out.

| Date | Decision | Rules out |
|---|---|---|
| 2026-11-06 | Foundational decisions (scope, stack, tenancy, wire compatibility, spec-first, providers, connections, source deletion) are in [gl-decisions-archive](./gl-decisions-archive.md). | Re-litigating them from memory |
| 2026-11-06 | The orchestrator is this Command Code session. Lanes: `cmd` (Command Code, deepseek-v4.1-flash) is the backend workhorse from normal to very hard; `grok` (Cursor, grok-4.7-high) takes medium backend and load relief; `sol` (Codex, gpt-6.1-sol) is reserved for boss-level work and all frontend logic; `agy` (Antigravity, gemini-3.8-flash-high) does UI only. | Claude Code and every `claude-*` model in the backend lanes. Antigravity for backend. Backend lanes for UI. |
| 2026-11-06 | `agy` quota is three independent pools: Gemini 3.8 Flash (5-hour + weekly), Gemini 4 Argon (weekly only, separate), Claude and GPT (5-hour + weekly). Argon is used only after the Gemini pool is spent; Claude only after Argon is spent or missing. Availability is per account, so it is probed before every dispatch. | Auto-upgrading UI work to Argon or Claude for quality. Assuming a model exists on a different account. |
| 2026-11-06 | Heavy frontend logic uses `Lane: fe`: `sol` while Codex's 5-hour usage is at or below 70%, `grok` above it. Usage is read from Codex's own rollout `rate_limits` snapshot (`primary`, 300 minutes), with a tracker and a 30-minute manual override as fallbacks; a passed `resets_at` means the window rolled over and usage is 0. Unknown falls back to `sol` with a warning. | Guessing Codex usage. Silently downgrading FE quality without recording it. |
| 2026-11-06 | Storage is two-tier: Postgres keeps knowledge and evidence pointers, S3 keeps bulk text under `sources/`, `chunks/`, `originals/`, `exports/`. Keys are content-addressed and immutable. `packages/storage` is the only holder of the AWS SDK. | Keeping source bodies in Postgres. Letting any package import the SDK directly. |
| 2026-11-06 | AWS: private S3 plus CloudFront with OAC and signed URLs; SSE-S3, no KMS; TLS-only bucket policy; private key in SSM SecureString; CloudFormation in `infra/`. `PriceClass_200` for Mumbai latency. Dev stack `memtavi-storage-dev` in `ap-south-1`, distribution `E22V6MKMFVBZ8C`. | Public buckets or OAI. Long-lived access keys committed anywhere. Re-enabling ACLs just to satisfy CloudFront v1 logging. |
| 2026-11-06 | Consent is per subject: `memory_settings.mode ∈ {auto, ask, off}`. MCP ships read-only first and the only write tool is `remember(claim, evidence, scope)`, never a transcript tool. | A capture-everything tool. Treating "off" as a soft delete. |
| 2026-11-06 | Reads are budgeted: the prompt index returns summaries only inside a token budget, with stable page hashes; bodies come from `read`. | Returning full pages from the index. Re-reading unchanged pages every turn. |
| 2026-11-06 | `sources/` and `chunks/` are never expired by a blind lifecycle rule. A citation-aware `storage-retention` job drops the body of an uncited source after 90 days, keeping its summary and hash. | A lifecycle expiration that deletes evidence a page still cites. |
| 2026-11-06 | Context is one always-loaded file with hard byte budgets, not a four-file preamble plus a glossary. | Growing `AGENTS.md` into a wiki |
| 2026-11-11 | Fern SDKs un-deferred. Missing manifests are Fern's plan gate (package metadata only for verified/paid orgs; `--local` is Enterprise-only), not a bug. Fern cloud generates the source into `sdks/typescript/src` and `sdks/python/src/memtavi`; we own the manifests (`@memtavi/sdk`, ESM, zero runtime deps; `memtavi` on PyPI, httpx + pydantic + typing_extensions). Generated source is committed with `sdks/spec.sha256`; CI fails if the hash is stale and builds and smoke-tests both SDKs without calling Fern. Fern CLI/MCP generators stay out; the hand-written CLI and MCP remain. | Paying for Fern only to get manifests. Docker `--local` generation. Hand-editing generated source. Calling Fern from CI. |
| 2026-11-11 | A deleted brain keeps a content-free tombstone row (`deletion_state = 'deleted'`) so its `deletion_ops` record survives the purge; brain slugs are unique among active brains only. | Deleting the row, which cascades the record away. |
| 2026-11-11 | Webhook events are a tenant-scoped `webhook_events` outbox written by database triggers on `change_events`, `connections` and `ingest_sources`; a trigger fans out PRD event subscriptions. Raw-action subscriptions keep the app-side enqueue. One idempotency key per webhook and event dedupes overlaps. | App-side producers in every code path, which miss writes and cross app boundaries. |
| 2026-11-11 | Per-request trace scope by wrapping `app.fetch` in `createApp` | `enterWith` in an Elysia hook leaked one request's trace into concurrent requests; Elysia has no public whole-pipeline hook. If Elysia stops routing `handle` and Bun.serve through `app.fetch`, move the wrapper to the server entry. |
| 2026-11-11 | Synchronous model calls made by the API record usage against a completed, never-claimable job row (`profile.suggest`) | `usage_ledger.job_id` is required; the row carries only model and prompt hash, and is purged with the brain. |
| 2026-11-11 | Index-dependent reads that RLS blocks go through a `SECURITY DEFINER` function repeating the policy predicate from transaction settings | Marking built-ins leakproof or weakening RLS is global; the definer pattern (`list_members`, `search_pages_keyword`) is narrow and tested per function. |
