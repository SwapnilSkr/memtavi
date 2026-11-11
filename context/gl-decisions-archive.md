---
id: gl-decisions-archive
when: researching why a foundational choice was made
holds: Settled decisions that no longer need loading per task, newest last
links: gl-decisions
---

# Archived decisions

Still binding. Kept out of the active log only to stay inside the node budget.

| Date | Decision | Rules out |
|---|---|---|
| 2026-11-06 | v1 is the memory layer plus inspector; Slack, Telegram, briefs, audio and the workspace wait. | Building the whole product family at once |
| 2026-11-06 | TypeScript monorepo on Bun + Elysia + Postgres + pgvector. | The Go design in the superseded PRD |
| 2026-11-06 | Tenancy replicates `tenant → subject → brain` with role-bearing API keys; `projects` exists from day 1 for Studio. | A flat user→brain model |
| 2026-11-06 | The API is drop-in wire-compatible with the reference product. | Designing our own field names in v1 |
| 2026-11-06 | OpenAPI 3.1 spec is the source of truth; Fern generates SDKs, CLI and the API-key MCP server. | Hand-writing five client surfaces |
| 2026-11-06 | Chat and extraction run on OpenRouter; embeddings run on OpenAI `text-embedding-3-small` at 1536 dims. OpenRouter has no embeddings endpoint. | Assuming one provider can do both |
| 2026-11-06 | Connections are undirected with an LLM-judged strength and a prose reason. Similarity is a signal, never an asserted relation. | The typed-edge graph in the superseded PRD |
| 2026-11-06 | Deleting an ingest source leaves derived pages in place; only brain deletion purges. | Recompiling pages on source deletion |
| 2026-11-06 | The document fetcher resolves once per hop, validates every address and pins the connection to the validated address; the transport never re-resolves. | Check-then-fetch, which a rebinding hostname walks into private space. |
| 2026-11-06 | Child tables (`page_versions`, `page_sources`, `page_embeddings`, `score_snapshots`, `briefs`, `webhook_deliveries`) carry a denormalised `tenant_id` with a leading index, composite parent FK and the same fail-closed RLS policy. `users` and `tenants` are closed to `memtavi_app`; `p0-auth` grants only what login needs. | Parent-derived policies, which leave direct access open. A tenant policy on `users`, which breaks pre-tenant login. |
| 2026-11-06 | CloudFront standard logging v1 is off because it requires ACLs on the log bucket; S3 access logs and CloudWatch metrics cover the gap. Use standard logging v2 to CloudWatch Logs if request-level logs are needed. | Turning ACLs back on for a logging path. |
| 2026-11-06 | The deployed `infra/storage.yaml` uses the legacy `Prefix` field in lifecycle rules because this account's CloudFormation schema rejects `Filter`; S3 normalizes it to the modern `Filter` form, verified in the live bucket. | Assuming a template field is ignored at runtime because its input form is old. |
| 2026-11-06 | Local database is Homebrew `postgresql@18` on `localhost:5434` with `brew`-managed pgvector 0.8.7, native arm64. Role `memtavi`; databases `memtavi_dev` and `memtavi_test`. The EDB PostgreSQL 18 on 5432 stays for the owner's other databases and is untouched by this repo. | Hand-built extensions inside an installer-managed cluster. Docker. |
| 2026-11-06 | TLS 1.2+ requires a custom domain: the default CloudFront certificate ignores `MinimumProtocolVersion` and stays at TLSv1, so the stack accepts `CertificateArn` + `AliasDomain` and switches to `sni-only` with `TLSv1.2_2021`. Production must set both. | Assuming a template property was applied because it was present. |
| 2026-11-06 | Biome is the only lint and format tool; no ESLint, no Prettier. One binary, one config, and the `lint` script is what CI runs. | Two formatters disagreeing on the same file |
| 2026-11-06 | Fern-generated SDKs and the OAuth connector are deferred: hand-written client, CLI and MCP are the public surfaces, and OAuth needs a human login route before it can be honest. | Faking a consent flow or shipping source-only SDK packages. |
| 2026-11-06 | Workers claim per configured tenant (`WORKER_TENANT_IDS`) rather than globally, because `memtavi_app` cannot enumerate tenants and an unscoped claim fails closed. Accepted for Phase 1; the scalable option is a `SECURITY DEFINER claim_job(types text[])` or a worker role exposing only pending `(id, tenant_id, type)`. | Granting the worker an owner connection or `BYPASSRLS` just to make the claim global. |
