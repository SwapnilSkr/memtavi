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
