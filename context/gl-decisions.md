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
| 2026-11-06 | v1 is the memory layer plus inspector; Slack, Telegram, briefs, audio and the workspace wait. | Building the whole product family at once |
| 2026-11-06 | TypeScript monorepo on Bun + Elysia + Postgres + pgvector. | The Go design in the superseded PRD |
| 2026-11-06 | Tenancy replicates `tenant → subject → brain` with role-bearing API keys; `projects` exists from day 1 for Studio. | A flat user→brain model |
| 2026-11-06 | The API is drop-in wire-compatible with the reference product. | Designing our own field names in v1 |
| 2026-11-06 | OpenAPI 3.1 spec is the source of truth; Fern generates SDKs, CLI and the API-key MCP server. | Hand-writing five client surfaces |
| 2026-11-06 | Chat and extraction run on OpenRouter; embeddings run on OpenAI `text-embedding-3-small` at 1536 dims. OpenRouter has no embeddings endpoint. | Assuming one provider can do both |
| 2026-11-06 | Connections are undirected with an LLM-judged strength and a prose reason. Similarity is a signal, never an asserted relation. | The typed-edge graph in the superseded PRD |
| 2026-11-06 | Deleting an ingest source leaves derived pages in place; only brain deletion purges. | Recompiling pages on source deletion |
| 2026-11-06 | The orchestrator is this Command Code session. Lanes: `cmd` (Command Code, deepseek-v4.1-flash) is the backend workhorse from normal to very hard; `grok` (Cursor, grok-4.7-high) takes medium backend and load relief; `sol` (Codex, gpt-6.1-sol) is reserved for boss-level work and all frontend logic; `agy` (Antigravity, gemini-3.8-flash-high) does UI only. | Claude Code and every `claude-*` model in the backend lanes. Antigravity for backend. Backend lanes for UI. |
| 2026-11-06 | `agy` quota is three independent pools: Gemini 3.8 Flash (5-hour + weekly), Gemini 4 Argon (weekly only, separate), Claude and GPT (5-hour + weekly). Argon is used only after the Gemini pool is spent; Claude only after Argon is spent or missing. Availability is per account, so it is probed before every dispatch. | Auto-upgrading UI work to Argon or Claude for quality. Assuming a model exists on a different account. |
| 2026-11-06 | Heavy frontend logic uses `Lane: fe`: `sol` while Codex's 5-hour usage is at or below 70%, `grok` above it. Usage is read from Codex's own rollout `rate_limits` snapshot (`primary`, 300 minutes), with a tracker and a 30-minute manual override as fallbacks; a passed `resets_at` means the window rolled over and usage is 0. Unknown falls back to `sol` with a warning. | Guessing Codex usage. Silently downgrading FE quality without recording it. |
| 2026-11-06 | Child tables (`page_versions`, `page_sources`, `page_embeddings`, `score_snapshots`, `briefs`, `webhook_deliveries`) carry a denormalised `tenant_id` with a leading index, composite parent FK and the same fail-closed RLS policy. `users` and `tenants` are closed to `memtavi_app`; `p0-auth` grants only what login needs. | Parent-derived policies, which leave direct access open. A tenant policy on `users`, which breaks pre-tenant login. |
| 2026-11-06 | Local database is Homebrew `postgresql@18` on `localhost:5434` with `brew`-managed pgvector 0.8.7, native arm64. Role `memtavi`; databases `memtavi_dev` and `memtavi_test`. The EDB PostgreSQL 18 on 5432 stays for the owner's other databases and is untouched by this repo. | Hand-built extensions inside an installer-managed cluster. Docker. |
| 2026-11-06 | Biome is the only lint and format tool; no ESLint, no Prettier. One binary, one config, and the `lint` script is what CI runs. | Two formatters disagreeing on the same file |
| 2026-11-06 | Context is one always-loaded file with hard byte budgets, not a four-file preamble plus a glossary. | Growing `AGENTS.md` into a wiki |
