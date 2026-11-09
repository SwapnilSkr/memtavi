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
| 2026-11-06 | Local database is Homebrew `postgresql@18` on `localhost:5434` with `brew`-managed pgvector 0.8.7, native arm64. Role `memtavi`; databases `memtavi_dev` and `memtavi_test`. The EDB PostgreSQL 18 on 5432 stays for the owner's other databases and is untouched by this repo. | Hand-built extensions inside an installer-managed cluster. Docker. |
| 2026-11-06 | Workers claim per configured tenant (`WORKER_TENANT_IDS`) rather than globally, because `memtavi_app` cannot enumerate tenants and an unscoped claim fails closed. Accepted for Phase 1; the scalable option is a `SECURITY DEFINER claim_job(types text[])` or a worker role exposing only pending `(id, tenant_id, type)`. | Granting the worker an owner connection or `BYPASSRLS` just to make the claim global. |
| 2026-11-06 | Storage is two-tier: Postgres keeps knowledge and evidence pointers, S3 keeps bulk text under `sources/`, `chunks/`, `originals/`, `exports/`. Keys are content-addressed and immutable. `packages/storage` is the only holder of the AWS SDK. | Keeping source bodies in Postgres. Letting any package import the SDK directly. |
| 2026-11-06 | AWS: private S3 plus CloudFront with OAC and signed URLs; SSE-S3, no KMS; TLS-only bucket policy; private key in SSM SecureString; CloudFormation in `infra/`. `PriceClass_200` for Mumbai latency. Dev stack `memtavi-storage-dev` in `ap-south-1`, distribution `E22V6MKMFVBZ8C`. | Public buckets or OAI. Long-lived access keys committed anywhere. Re-enabling ACLs just to satisfy CloudFront v1 logging. |
| 2026-11-06 | TLS 1.2+ requires a custom domain: the default CloudFront certificate ignores `MinimumProtocolVersion` and stays at TLSv1, so the stack accepts `CertificateArn` + `AliasDomain` and switches to `sni-only` with `TLSv1.2_2021`. Production must set both. | Assuming a template property was applied because it was present. |
| 2026-11-06 | CloudFront standard logging v1 is off because it requires ACLs on the log bucket; S3 access logs and CloudWatch metrics cover the gap. Use standard logging v2 to CloudWatch Logs if request-level logs are needed. | Turning ACLs back on for a logging path. |
| 2026-11-06 | Consent is per subject: `memory_settings.mode ∈ {auto, ask, off}`. MCP ships read-only first and the only write tool is `remember(claim, evidence, scope)`, never a transcript tool. | A capture-everything tool. Treating "off" as a soft delete. |
| 2026-11-06 | Reads are budgeted: the prompt index returns summaries only inside a token budget, with stable page hashes; bodies come from `read`. | Returning full pages from the index. Re-reading unchanged pages every turn. |
| 2026-11-06 | `sources/` and `chunks/` are never expired by a blind lifecycle rule. A citation-aware `storage-retention` job drops the body of an uncited source after 90 days, keeping its summary and hash. | A lifecycle expiration that deletes evidence a page still cites. |
| 2026-11-06 | The deployed `infra/storage.yaml` uses the legacy `Prefix` field in lifecycle rules because this account's CloudFormation schema rejects `Filter`; S3 normalizes it to the modern `Filter` form, verified in the live bucket. | Assuming a template field is ignored at runtime because its input form is old. |
| 2026-11-06 | Biome is the only lint and format tool; no ESLint, no Prettier. One binary, one config, and the `lint` script is what CI runs. | Two formatters disagreeing on the same file |
| 2026-11-06 | Context is one always-loaded file with hard byte budgets, not a four-file preamble plus a glossary. | Growing `AGENTS.md` into a wiki |
| 2026-11-06 | Fern-generated SDKs and the OAuth connector are deferred: hand-written client, CLI and MCP are the public surfaces, and OAuth needs a human login route before it can be honest. | Faking a consent flow or shipping source-only SDK packages. |
