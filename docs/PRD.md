# Memtavi — Product Requirements & Engineering Plan

**Status:** v1.0 proposal · 6 Nov 2026
**Supersedes:** `Memory_Platform_PRD_and_Architecture.pdf` (the Go/Postgres proposal)
**Scope of this document:** rewritten PRD + full engineering plan for v1, with the architectural seams required for full product parity later.

---

## 0. Decisions locked

| # | Decision | Choice |
|---|---|---|
| 1 | v1 boundary | Memory layer + inspector. No workspace, Slack, Telegram, or audio in v1. |
| 2 | Long-term goal | Full parity including a ChatChat-equivalent workspace product (working name **Memtavi Studio**). |
| 3 | Backend stack | TypeScript monorepo. Bun + Elysia + Postgres + pgvector. |
| 4 | Tenancy | Replicate exactly: `tenant → subject → brain`, role-bearing API keys. Plus a `projects` table from day 1 for Studio. |
| 5 | API contract | **Drop-in wire-compatible** with Living Brain: same paths, same field names, same enums, same headers. |
| 6 | Chat / extraction | OpenRouter (default), provider-agnostic interface. |
| 7 | Embeddings | OpenAI `text-embedding-3-small` (1536 dims), separate interface. OpenRouter has no embeddings endpoint. |
| 8 | Cross-surface tooling | OpenAPI 3.1 spec is the source of truth; Fern generates TS SDK, Python SDK, CLI, and the API-key MCP server. |
| 9 | Env vars | Reuse `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_PREFERRED_P90_LATENCY_SECONDS` from the existing `everlore-server` env. Never commit values. |

### Product naming

- **Memtavi** — the company/product family.
- **Memtavi Memory** — v1: the brain layer (API, SDKs, CLI, MCP, inspector).
- **Memtavi Studio** — later: the workspace product (agents, group chats, tools, schedules, skills, seats, credits, billing).

Key prefixes are ours (`mtv_live_...`); header names stay generic (`x-api-key`, `x-subject-id`) for compatibility; webhook signatures use `x-memtavi-signature`.

---

## 1. Product definition (rewritten PRD)

### 1.1 Vision

A persistent, source-linked memory layer that compiles what a user reads, writes, and says into maintained pages, then serves the right slice of that context to any agent through one API.

The unit is a **page**, not a chunk. A page is compiled when material arrives, so a later question starts from knowledge that already combines the relevant facts instead of having to rediscover their relationship on every query.

### 1.2 Who it is for

| Segment | Need | Primary surface |
|---|---|---|
| Developers building agents | Scoped memory without building a compiler | REST API, SDKs, MCP |
| Coding-agent users | Decisions that survive session death | CLI, MCP |
| Individuals and small teams | Inspect, correct, and trust what the system remembered | Inspector |
| (later) Teams running agents | Agents + memory in one workspace | Studio |

### 1.3 The problem

Context is fragmented across tools. Re-sending full history is expensive and surfaces stale facts. Existing memory approaches store fragments and rebuild relationships per query; they have no notion of a current, authoritative page, no evidence trail, and no way for a human to correct the record.

### 1.4 The promise, stated honestly

- Memory is **compiled and editable**, with every claim traceable to a source span.
- Retrieval is **scoped** to a brain and an end-user subject; cross-tenant access is a bug, not a feature flag.
- Disagreement is **preserved**, not silently resolved: conflicting material marks a page `contested` and keeps both claims until a human decides.
- The system does **not** promise perfect recall, automatic capture from apps it isn't connected to, or factual truth. A similarity score is not a probability of correctness.

### 1.5 Success metrics (measurable, with the harness to prove them)

| Metric | Target | How measured |
|---|---|---|
| Retrieval recall@5 | ≥ 80% | LoCoMo labelled set, per question type |
| Answer accuracy (judged) | ≥ 85% | LoCoMo v1.2.0, 1,540 questions, pinned judge model |
| Context efficiency | ≤ 12K tokens/question | Token count of retrieved memory only |
| Retrieval latency | p95 < 500ms | 10k-page synthetic brain, exact search |
| Capture completion | p95 < 3 min for ≤10k chars | Excludes provider outages |
| Tenant isolation failures | **0** | Isolation suite hitting every endpoint with foreign IDs |
| Citation coverage | ≥ 90% of sampled claims | 100 sampled page claims, manual review |
| Merge safety | < 2% cross-entity merges | Labelled Acme/Apex-style near-duplicate set |

The last two are the ones that decide whether the product is trustworthy. Everything else is table stakes.

### 1.6 Non-goals for v1

Autonomous agents, model fine-tuning, enterprise SSO, mobile apps, billing, on-prem/air-gapped deployment, audio/video transcription, Slack and Telegram integrations, daily briefs, MCP Apps interactive UI, and the Studio workspace. Each has a named phase below.

### 1.7 Core user stories

- As a developer, I POST a capture and get a receipt, then a webhook tells me the page is ready. I never poll in a loop.
- As a user, I ask "why did we move the launch date?" and get one current page with the date, the reason, and the transcript it came from.
- As a user, I edit a page; the compiler stops overwriting my wording and appends updates instead.
- As a user, I see a page marked contested, read both claims, and choose which stands.
- As a developer, I load the prompt index at session start and search per question, instead of shipping the whole brain.
- As an agent, I can read memory but never write to it without an explicit capture call.
- As an operator, I can see cross-tenant attempts, per-tenant token spend, and a kill switch.

---

## 2. Parity contract

This is the scope ledger. Everything listed as v1 must behave equivalently to the reference product; the "later" column is explicitly out of v1.

### 2.1 Surfaces

| Surface | v1 | Later |
|---|---|---|
| REST API (`/v1/...`) | All Brains, Captures, Workspace, Webhooks endpoints | — |
| TypeScript SDK | Generated (Fern) | — |
| Python SDK | Generated (Fern) | — |
| CLI | Generated (Fern), `livingbrain`-equivalent command surface | — |
| MCP (API key) | Generated (Fern), Streamable HTTP, ~57 tools | — |
| MCP (OAuth sign-in) | Tools + resources, scoped to `mematvi:list/manage/search/read/capture` | MCP Apps interactive search + graph UI |
| Inspector web app | Brains, captures, pages, search, conflicts, profile, health, settings | Graph canvas |
| Slack | — | v1.5 |
| Telegram | — | v1.5 |
| Daily briefs | — | v1.5 |
| Studio (ChatChat equivalent) | — | v2 |

### 2.2 Domain model parity

| Concept | Shape |
|---|---|
| Brain | `id, tenantId, subjectId, name, slug, description, briefSettings, createdAt, updatedAt` |
| Capture | `kind ∈ {note,url,file,transcript,chat_turn,integration}`, exactly one of `content`/`fetchUrl`, `originRef` as idempotency key, 50k char inline cap |
| Ingest source | `status ∈ {pending,compiling,completed,failed}`, `attempts`, `lastError`, `affectedPageIds`, `chunkUuids` |
| Page | `slug, title, summary, body, entities[], backlinks[], sources[], version, pinned, archived, status` |
| Page types | `source, topic, entity, project, decision, brief` |
| Buckets | `inbox, notes, ideas, projects` + `bucketSource ∈ {auto,user}` |
| Page status | `active, stale, contested, deprecated, archived` |
| Connection | unordered pair, `strength ∈ {weak,medium,strong}`, model-written `reasoning`, `source ∈ {auto,manual}`, `ackedAt` |
| Change event | `action ∈ {created,updated,renamed,merged,split,archived,restored,recovered,routed}`, `fromVersion`, `toVersion`, `contradictions[]`, `ackedAt` |
| Profile | 7 free-text fields + 4 directive booleans + `custom` |

### 2.3 Deliberate quirks we keep for compatibility

These look wrong but are load-bearing for drop-in compatibility:

- `404` (not `403`) for a brain owned by another subject — non-probeable.
- `DELETE /pages/{slug}` requires `permanent=true`; it is a confirmation, not a soft-delete flag.
- `getPage` bumps `lastReferencedAt`, which feeds health. Do not call it to hydrate list views.
- Keyword matches bypass `minSimilarity`; semantic matches do not.
- `similarity` carries the vector score only, so results can appear out of similarity order.
- `deprecated` (system-superseded, recoverable) is distinct from `archived` (user-retired, restorable).
- Deleting an ingest source **leaves derived pages in place**. There is no recompile-on-source-delete.

---

## 3. Corrections to the existing PRD

The old PRD was a coherent Go design for a *similar* product. These are the substantive divergences that must change.

| Old PRD | Replaced by |
|---|---|
| Typed edges: `related_to`, `part_of`, `supersedes`, `conflicts_with` | Undirected connections with LLM-judged strength + prose reason. Similarity is a signal, never an asserted relation. |
| No page taxonomy | 6 page types, 4 buckets, auto/user routing provenance |
| No prompt index | Prompt index is a first-class read path — arguably the most-used endpoint |
| Conflicts resolved via page-version history | `contested` status + `contradictions[]` on the change event + explicit `resolve` with a note |
| Deletion recompiles affected pages from surviving evidence | Source deletion leaves pages untouched. Only brain deletion purges. Removes an entire distributed-consistency problem. |
| `org → brain` | `tenant → subject → brain`, with role-bearing keys and pass-through subject headers |
| Retry preserves source ID, recompiles | Retry only on `failed`; a retry does not double-count storage |
| Graph as P1 "one-hop expansion" | Bounded graph endpoint for visualisation; retrieval uses connections as candidates, not traversal |
| Own auth (OIDC or Go sessions) | Better Auth for humans, our own hashed API keys for machines, OAuth 2.1 provider for the MCP connector |
| Go modular monolith | Bun + Elysia modular monolith, two processes (api, worker) from one repo |
| MCP as P1 read/search/capture | Two MCP surfaces: generated 1:1 tool server + scoped OAuth connector |
| Implicit "pages" only | Pages **plus** connections, change feed, health, profile, briefs — the product is the whole loop |
| Recall@5 only | Recall@5 **and** merge safety **and** citation coverage. Quality is not one number. |

Two PRD claims were also unsupported and are dropped: "p95 < 1.5s on 10k pages" as a plan (now a measured gate) and "95% of captures within 5 minutes" without a defined denominator (now p95 with an explicit char cap).

---

## 4. Architecture

### 4.1 Monorepo layout (Bun workspaces)

```
memtavi/
├─ package.json                 bun workspaces + scripts
├─ bunfig.toml
├─ infra/                       CloudFormation: private S3 + CloudFront (OAC, signed URLs)
├─ .env.example                 OPENROUTER_API_KEY, OPENAI_API_KEY, DATABASE_URL, ...
│
├─ apps/
│  ├─ api/
│  │  ├─ src/index.ts                   Elysia bootstrap, OTel, graceful shutdown
│  │  ├─ src/routes/brains.ts
│  │  ├─ src/routes/captures.ts
│  │  ├─ src/routes/workspace.ts        pages, search, index, graph, connections,
│  │  │                                 changes, score, profile, export
│  │  ├─ src/routes/webhooks.ts
│  │  ├─ src/routes/admin.ts            tenant, members, API keys
│  │  ├─ src/routes/oauth.ts            MCP connector authorization
│  │  └─ src/middleware/
│  │     ├─ request-id.ts  errors.ts  rate-limit.ts
│  │     ├─ auth.ts                     api key → tenant + role
│  │     └─ scope.ts                    withTenant() transaction + RLS
│  │
│  ├─ worker/
│  │  ├─ index.ts                       poll loop, concurrency, leases
│  │  └─ handlers/
│  │     ├─ capture-compile.ts  page-embed.ts  connection-discover.ts
│  │     ├─ score-snapshot.ts   brief-run.ts   webhook-deliver.ts
│  │     └─ deletion.ts         export-build.ts
│  │
│  └─ web/                              Vite + React + TS + Tailwind inspector
│     ├─ src/routes/{brains,brain/pages,brain/page,brain/search,brain/conflicts,
│     │              brain/health,brain/profile,settings}.tsx
│     ├─ src/features/{capture,pages,search,connections,conflicts,health,profile}
│     ├─ src/lib/api.ts                 generated client
│     └─ src/lib/query.ts               TanStack Query client + invalidation map
│
├─ packages/
│  ├─ spec/
│  │  ├─ openapi.yaml                   canonical contract (hand-authored)
│  │  └─ compat/                        diff harness vs reference shapes
│  ├─ core/                             pure domain — no HTTP, no ORM
│  │  ├─ compile/{extract,route,patch,record,link}.ts
│  │  ├─ compile/policies/{mws,pfs,crs,rps}.ts
│  │  ├─ compile/schemas.ts             zod contracts for LLM output
│  │  ├─ search/{hybrid,index-rank}.ts
│  │  ├─ health/compute.ts
│  │  └─ tokens/budget.ts
│  ├─ db/
│  │  ├─ schema.ts                      Drizzle schema
│  │  ├─ migrations/                    SQL migrations
│  │  ├─ client.ts                      pooled client, per-request SET LOCAL
│  │  └─ rls.sql
│  ├─ llm/
│  │  ├─ provider.ts                    ChatProvider + EmbeddingProvider interfaces
│  │  ├─ openrouter.ts  openai-embeddings.ts  fake.ts
│  │  └─ prompts/                       versioned prompt files
│  ├─ jobs/{queue,lease,backoff}.ts
│  └─ shared/{ids,errors,config,logging}.ts
│
├─ fern/
│  ├─ fern.config.json
│  └─ generators.yml                    ts-sdk, python-sdk, cli, mcp
├─ tests/
│  ├─ contract/                         every response validates against spec
│  ├─ isolation/                        cross-tenant matrix
│  ├─ integration/                      real Postgres + pgvector
│  └─ eval/                             locomo + longmemeval harness
└─ docs/
```

### 4.2 Stack rationale

- **Bun + Elysia** — matches the conventions already in `everlore-server` (Bun, Elysia, `src/{routes,services,schemas,providers,queues}`). One runtime for API and worker.
- **Postgres + pgvector** — one authoritative store for records, vectors, relations, and jobs. No Redis in the critical path; `FOR UPDATE SKIP LOCKED` is sufficient at this size.
- **Drizzle** — typed schema, real SQL migrations, `sql` escape hatch for FTS, vector distance, leases, RLS. No ORM magic standing between us and the query plan.
- **Fern** — the reason the reference product has an API, two SDKs, a CLI, and an MCP server for a small team. Spec-first is the highest-leverage decision in this build.
- **Better Auth** — self-hosted, TS-native, org/membership/role plugin, API-key plugin, OAuth provider plugin. Covers humans in the inspector and the MCP connector, without a vendor.
- **OpenRouter (chat) + OpenAI (embeddings)** — cost and model choice where it matters (extraction), a stable embedding space where re-embedding is expensive.

### 4.3 Tenancy and request lifecycle

Every request:

1. `x-api-key` → hash lookup → `{tenantId, role}`. Missing → `401 Missing API key`; unknown → `401 Invalid API key`.
2. `x-subject-id` → must be a UUID; Unowned brain → `404`.
3. Open a transaction and `SET LOCAL app.tenant_id = ...`, `app.subject_id = ...`.
4. Query with both an explicit predicate **and** RLS. Predicates are primary; RLS is defence in depth.
5. Emit `audit_events` for security-relevant actions (key creation, deletion, export). Never log page bodies.

Workers run as a separate role that can bypass RLS only for the tenant recorded on the job row, and that bypass is asserted in a test.

---

## 5. Data model

Extensions: `vector`, `pg_trgm`, `unaccent`, `citext`.

### 5.1 Identity and tenancy

| Table | Key columns / invariants |
|---|---|
| `tenants` | `id, name, slug unique, plan, created_at` |
| `users` | `id, email citext unique, name, password_hash, image, created_at` |
| `memberships` | `(tenant_id, user_id) PK, role ∈ {owner,admin,developer,viewer}` |
| `sessions` | Better Auth managed, `tenant_id` bound at login |
| `api_keys` | `id, tenant_id, created_by, name, prefix, key_hash unique, role, scopes[], last_used_at, expires_at, revoked_at` |
| `subject_links` | `(tenant_id, subject_id) PK, user_id nullable` — subjects stay opaque UUIDs; Studio attaches them to users later |
| `projects` | `id, tenant_id, owner_user_id, name, slug, kind ∈ {personal,team,production}` — present in v1, used by Studio in v2 |

### 5.2 Memory core

| Table | Key columns / invariants |
|---|---|
| `brains` | `id, tenant_id, subject_id, project_id?, name, slug, description, brief_settings jsonb, deletion_state, timestamps`; `unique(tenant_id, subject_id, slug)` |
| `ingest_sources` | `id, tenant_id, subject_id, brain_id, kind, content, content_hash, origin_ref, label, bucket, metadata jsonb, status, attempts, last_error, affected_page_ids uuid[], chunk_uuids uuid[], original_bytes, compiled_at, deleted_at`; partial unique `(brain_id, origin_ref) WHERE origin_ref IS NOT NULL AND deleted_at IS NULL` |
| `source_chunks` | `id, tenant_id, brain_id, source_id, ordinal, text, char_start, char_end, token_count` |
| `pages` | `id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, bucket, bucket_source, status, pinned, archived, version, entities text[], backlinks text[], content_hash, embedding_model, last_compiled_at, last_referenced_at, user_edited_at, deletion_state`; unique `(brain_id, slug)`; generated `search_tsv` GIN; `entities` GIN |
| `page_versions` | `id, page_id, version, title, summary, body, ingest_source_id?, actor ∈ {compiler,user}, created_at`; unique `(page_id, version)`; immutable, no UPDATE/DELETE grants |
| `page_sources` | `(page_id, ingest_source_id) PK, chunk_uuids uuid[], attached_at` |
| `page_embeddings` | `(page_id, model) PK, dimensions, embedding vector(1536), content_hash, created_at` — skip re-embed when `content_hash` matches |
| `connections` | `id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source ∈ {auto,manual}, acked_at`; canonical ordering `a < b`; unique `(brain_id, page_a_id, page_b_id)` |
| `routing_reviews` | `id, tenant_id, brain_id, ingest_source_id, fact jsonb, candidate_page_ids uuid[], best_gap, status ∈ {open,resolved,dismissed}, resolution` — where PFS's "review" outcome lands |
| `change_events` | `id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version, ingest_source_id?, contradictions jsonb, acked_at, created_at` |
| `profiles` | `brain_id PK, tenant_id, who_they_are, what_they_do, focus, goals, current_projects, stuck_on, vault_organization, directives jsonb` |
| `score_snapshots` | `id, brain_id, computed_at, freshness, readiness, strain, factors jsonb`; index `(brain_id, computed_at)` |
| `briefs` | `id, brain_id, page_id, for_date`; unique `(brain_id, for_date)` |

### 5.3 Operability

| Table | Purpose |
|---|---|
| `jobs` | `id, tenant_id, brain_id, type, payload, idempotency_key, status, attempts, max_attempts, available_at, lease_until, last_error`; index `(status, available_at)` |
| `webhooks` | `id, tenant_id, subject_id, url, events[], secret_enc, active` |
| `webhook_deliveries` | `id, webhook_id, event_id, payload, status, attempts, next_attempt_at, response_status, last_error` |
| `idempotency_keys` | `(tenant_id, scope, key) PK, request_hash, response_status, response_body, expires_at` |
| `deletion_ops` | `id, tenant_id, brain_id, target_type ∈ {brain,source,page}, target_id, state, detail` |
| `usage_ledger` | `id, tenant_id, brain_id, job_id, provider, model, kind ∈ {chat,embedding}, input_tokens, output_tokens, cost_usd` |
| `budget_caps` | `tenant_id PK, monthly_usd, hard_stop, current_period_spend` |
| `audit_events` | `id, tenant_id, actor_type, actor_id, action, target_type, target_id, metadata jsonb` — no content |

### 5.4 RLS policy shape

```sql
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pages
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Applied to every tenant-scoped table. A test asserts a request with tenant A cannot read tenant B across every route, and that a missing setting fails closed (empty set, not full access).

---

## 6. The compiler

This is the product. Everything else is plumbing.

### 6.1 Stages

```
capture → extract text → chunk & dedupe → extract facts → MWS → PFS route
        → patch → record version → embed → discover connections → emit change event
```

Each stage is its own job type with its own attempt counter, so a failure is addressable and a page can be saved even when embedding fails.

**1. Extract text.** `note`/`integration` inline; `url` via fetch + readability + sanitise (SSRF guards: block private ranges, revalidate every redirect, 10s timeout, 10MB cap); `file` via PDF/DOCX/PPTX/HTML parsers behind `fetchUrl` + `mimeType`/`fileName`; `chat_turn` runs the worthiness classifier first; `transcript` audio is **not** in v1.

**2. Chunk and dedupe.** Normalise whitespace, store chunks with `char_start`/`char_end` for evidence spans. Dedupe on `content_hash`, then on `origin_ref`. Re-sending the same `origin_ref` returns the existing source rather than creating a second one.

**3. Extract facts.** One structured-output call per chunk batch. Zod-validated; unsupported claims rejected.

```ts
type ExtractedFact = {
  claim: string;
  kind: "preference" | "project_fact" | "decision" | "entity_attribute"
      | "event" | "commitment" | "other";
  entities: string[];
  validFrom?: string; validTo?: string;
  evidence: { chunkUuid: string; charStart: number; charEnd: number; quote: string };
  confidence: number;                       // 0..1
  durability: number; impact: number; recurrence: number;
  novelty: number; futureUse: number;       // 0..1
  sensitivity: "none" | "personal" | "secret" | "regulated";
};
```

**4. MWS — keep it?** Gated first, then scored. `secret`/`regulated` → source-only, flagged, never placed on a page. Score = weighted sum of durability, impact, recurrence, novelty, future use, extraction confidence, minus an unsuitable-material penalty. Bands: `≥0.65` Durable, `0.35–0.65` Provisional, `<0.35` Source-only. A low score deletes nothing — the fact stays findable in its source.

**5. PFS — which page?** Hybrid candidate retrieval, then per-candidate signals: meaning match, word match, shared entities, relationship judgement, time compatibility, graph proximity, routing history. Gate on page status (`active`/`contested`), same brain, not deleted.

Compute `gap = best − second`:

| Condition | Outcome |
|---|---|
| `gap ≥ 0.15` and `best ≥ 0.45` | **Place** on the best page |
| `gap < 0.15` and `best ≥ 0.45` | **Review** — write `routing_reviews`, do not merge |
| otherwise | **New location** — create a page |

The review band is the Acme/Apex defence. A small gap must never become a merge, because a page that blends two customers reads smoothly and answers wrongly about both.

**6. Patch.** Rewrite the chosen page in full, preserving what it already says. One call, returning:

```ts
type PatchResult = {
  title: string; summary: string; body: string;
  changed: boolean;
  contradictions: { existingClaim: string; newClaim: string; evidence: ExtractedFact["evidence"] }[];
};
```

Rules: never invent; cite sources as a `## Sources` block plus inline evidence pointers; if `contradictions.length > 0`, do not overwrite — set `status = contested`, keep both claims, and record `contradictions[]` on the change event. If `pages.user_edited_at > pages.last_compiled_at`, append an `## Updates` section instead of rewriting the body.

**7. Record.** New `page_versions` row (immutable), `page_sources` upsert, `change_events` with the right `action` (`created`/`updated`/`merged`/`split`/`routed`), bump `version`, emit outbox.

Internal operations with no endpoints (parity requires the events, not the API): **merge** when PFS places repeatedly on two near-duplicate pages across a batch, **split** when a page exceeds a size budget covering distinct entities.

**8. Embed.** `title + summary + first 2,000 body chars` — matching the reference behaviour, and explicitly *not* the whole body. Keyed by `content_hash` + model, so unchanged pages cost nothing.

**9. Discover connections.** Nearest 8 pages by embedding, then one batched LLM call judging pairs: `strong` (reading one changes how you read the other), `medium`, `weak`, or noise (dropped). Store a one-line `reasoning`. Canonicalise the pair. Gate on permission before scoring, so a page is never linked to one the caller cannot see.

**10. Emit.** `change_events` row, webhook fan-out via outbox, score snapshot invalidation.

### 6.2 Policy configuration

All thresholds and weights live in `packages/core/compile/policies/*.ts` as exported constants with a documented rationale and a unit test per signal. The reference product does not publish its weights; ours are ours to tune, and every change must be paired with an eval run.

### 6.3 Failure semantics

- Transient (429/5xx/timeout): exponential backoff with jitter, `available_at` in the future.
- Permanent (schema validation, unsupported format): `failed` with `lastError`, retryable only by explicit `POST .../retry`.
- Dead-letter after `max_attempts`; surfaced in the inspector as "needs attention".
- Provider circuit breaker per model; falling back to a configured secondary model is allowed for extraction, never for embeddings (dimension and space must not change mid-brain).

---

## 7. Read paths

### 7.1 Search

```
keyword  → ts_rank over generated search_tsv (title A, summary B, body C)
semantic → 1 - (embedding <=> q) over page_embeddings, filtered by brain
        → dedupe by page_id → RRF fuse (k=60) → top K
```

Response carries `similarity` (vector only), `matchedOn ∈ {semantic,keyword,both}`, and a snippet. `minSimilarity` defaults to `0.35` and **only filters semantic-only matches**. Empty result set returns `200 []`, never an error.

Exact search first. HNSW only after the benchmark harness shows the need — filtered approximate search is exactly where recall quietly dies.

### 7.2 Prompt index

`GET /v1/brains/{id}/index?limit=40` returns `[{slug,title,summary(160),pageType,pinned,status}]`.

Rank: pinned first, then `0.4·impact + 0.3·recency + 0.2·referenceCount + 0.1·connectionStrength`. Pinned pages are exempt from deprecation.

### 7.3 Graph

`GET /v1/brains/{id}/graph?nodeLimit=150` → `{nodes[], edges[], truncated}`. Bounded by node limit; edges only between returned nodes.

### 7.4 Connections browse

Filter by minimum `strength`, `unackedOnly`. Dismiss sets `acked_at` without deleting.

---

## 8. Health, profile, change feed, webhooks

### 8.1 Health scores

Three 0–100 metrics, each returning `factors[{key,label,description,value,unit,tone}]`.

| Metric | Raises | Lowers |
|---|---|---|
| Freshness | Recent completed captures, page changes | Time passing with no input |
| Readiness | Page count, searchable pages, profile completeness | Failed sources, unresolved contested pages |
| Strain (lower better) | — | Failed sources, compile backlog, contested/deprecated pages, unacked changes/connections |

Computed deterministically in `packages/core/health/compute.ts`, snapshotted daily and on demand. `GET /score/history?range=7d|30d|90d` returns points plus delta. `POST /score/suggestions` returns a deterministic rule set with `generatedBy: "rules"`, each suggestion carrying `action`/`actionLabel`/`priority`.

### 8.2 Profile

Seven free-text fields plus directives. Non-retroactive: changes apply to future captures only. `POST /profile/suggestions` infers fields from existing pages, best-effort, empty set when signal is thin.

### 8.3 Change feed

Every mutation emits an event. `since` for machine sync, `unackedOnly` for a human inbox. Ack is a read marker, not a delivery receipt — documented explicitly, because conflating the two is how sync systems lose events.

### 8.4 Webhooks

Five event types: `brain.page.updated`, `brain.change.new`, `brain.connection.new`, `brain.brief.ready`, `brain.import.progress`. Signing secret returned exactly once. Delivery via outbox with HMAC-SHA256 in `x-memtavi-signature`, timestamped, retried with backoff, dead-lettered after 8 attempts.

### 8.5 Export and deletion

- `GET /export/markdown` — one bundle, YAML front-matter per page, optional deprecated.
- Page delete — `permanent=true` required, cascades versions + connections, no undo.
- Brain delete — soft-delete, state machine in `deletion_ops`, retrieval excludes immediately, purge async.
- Source delete — removes the source and its chunks; **pages stay**.

---

## 9. API contract

### 9.1 Source of truth

`packages/spec/openapi.yaml`, OpenAPI 3.1, hand-authored. The reference product's published spec is used as a **compatibility target and diff reference**, not copied. Every path, parameter, and response field is re-authored and then verified against a shape-diff harness in `packages/spec/compat/`.

That harness is the thing that makes "drop-in compatible" a testable claim instead of an aspiration.

### 9.2 Conventions

- `x-request-id` echo on every response.
- Error envelope identical in shape:
  ```json
  { "statusCode": 401, "timestamp": "...", "path": "/v1/brains",
    "message": "Invalid API key",
    "body": { "message": "...", "error": "Unauthorized", "statusCode": 401 } }
  ```
- Offset pagination on lists (`items,total,limit,offset`), matching the reference.
- `429` with `Retry-After`; limits configurable per plan (defaults 300/min API, 120/min MCP).
- Idempotency-Key honoured on capture endpoints, stored in `idempotency_keys`.

### 9.3 Generated surfaces (Fern)

`fern/generators.yml` declares `typescript-sdk`, `python-sdk`, `cli`, and `mcp`. Regenerating after a spec change is one command in CI, so the SDK, CLI, and 1:1 MCP tool server can never drift from the API.

The hand-built pieces Fern cannot generate:
- The OAuth connector MCP (`apps/api/src/routes/oauth.ts` + a small MCP server using `@modelcontextprotocol/sdk`) with scopes and resources.
- The inspector's typed client wrapper.

---

## 10. Inspector (web)

Vite + React + TypeScript + Tailwind. TanStack Query for server state, Zustand only for ephemeral UI state (selected brain, panel, filters). Never persist API keys or page bodies in browser storage.

Screens:

| Screen | Contents |
|---|---|
| Brains | List, create, rename, delete, health badges |
| Capture | Composer (note/URL/file), queue with live status, per-source error + retry |
| Pages | Bucket navigation with counts, status filters, search, infinite list |
| Page detail | Markdown body, summary, version history + diff, sources with chunk evidence, connections, pin/rename/move/archive/restore/delete |
| Conflicts | Contested queue, both claims side by side with evidence, resolve with a note |
| Health | Three metrics with factor breakdown, 30-day trend, ranked suggestions |
| Profile | Editor + inferred suggestions |
| Settings | API keys (shown once), webhooks + signing secret, export, brain deletion progress |

The page-detail screen is the one that decides whether people trust the product. Evidence must be one click from a claim, always.

---

## 11. Security, ops, cost

### 11.1 Security baseline

- TLS everywhere; secrets from env/secret manager only.
- API keys stored as SHA-256 hashes, shown once, revocable, role-bearing.
- Session cookies `HttpOnly`, `Secure`, `SameSite=Lax`; CSRF token on state-changing browser routes.
- SSRF protection on URL/file fetch: DNS resolution check, private-range block, redirect revalidation, size and time caps.
- Parameterised SQL only; no string-built queries.
- Audit events on key lifecycle, deletion, export, and permission changes — metadata only, never content.
- Cross-tenant tests are a merge gate, not a nice-to-have.

### 11.2 Observability

OpenTelemetry traces across `api → job → provider`, metrics for ingestion stage latency, queue depth, search p95, empty-result rate, token spend, deletion lag, and cross-tenant test results. Structured logs with request ID and tenant ID, never bodies.

### 11.3 Cost control

- Per-capture cost estimate before enqueue; reject when the tenant is over its cap.
- `usage_ledger` records every provider call with tokens and computed USD.
- `budget_caps` with an optional hard stop and an operator kill switch (`BUDGET_EMERGENCY_STOP=true`).
- Embed compiled pages only, keyed by content hash; never embed chat turns.
- Small model for extraction/classification, larger model only for patching.

---

## 12. Testing and evaluation

**Unit** (`packages/core`) — policy bands, gap outcomes (place/review/new), rank fusion, state transitions, idempotency, change-action mapping, health formulas.

**Contract** — every route's response validated against `openapi.yaml` with AJV; shape-diff against the reference spec for compatibility drift.

**Integration** — real Postgres + pgvector: scoped FTS and vector search, concurrent page edits, lease expiry and retry, RLS fail-closed, deletion cascades.

**Isolation** — a generated matrix hitting every endpoint with a foreign `brainId`, `pageId`, `sourceId`, `changeId`, `connectionId`, and a foreign `x-subject-id`. Zero tolerance.

**Evaluation** (`tests/eval`) — LoCoMo v1.2.0 and LongMemEval-S harnesses. Ingest → answer → judge, reporting accuracy by question type, context tokens, and retrieval latency. Labelled near-duplicate set for merge safety. This harness is built **before** the compiler is tuned, because otherwise every quality argument is vibes.

**Load** — 10k-page synthetic brain, p50/p95 search, capture throughput, worker crash recovery.

---

## 13. Delivery phases

No dates. Each phase has an exit gate; the gate is what moves us forward.

### Phase 0 — Foundation
Repo, Bun workspaces, docker-compose (Postgres+pgvector, MinIO), Drizzle schema + first migration, RLS policies, Better Auth wiring, API-key issuance, `openapi.yaml` skeleton, Fern config, CI (typecheck, lint, unit, contract, isolation), `.env.example` with `OPENROUTER_API_KEY` and `OPENAI_API_KEY`.

**Gate:** an authenticated request creates a brain, a second tenant gets `404`, and CI is green.

### Phase 1 — Capture and the compiler
Capture endpoints (note/url/file/chat_turn), ingest source lifecycle, jobs + leases, extract → MWS → PFS → patch → record → embed, eval harness running against LoCoMo.

**Gate:** a URL capture produces a compiled page with evidence; the same `originRef` twice does not double-ingest; LoCoMo accuracy is measured, whatever the number, and merge safety has a baseline.

### Phase 2 — Read paths and inspector
Hybrid search, prompt index, pages/buckets/versions, page detail with evidence, capture queue, version diff.

**Gate:** every page claim resolves to a chunk; search p95 measured on 10k pages; the inspector can complete capture → read → correct without touching the API.

### Phase 3 — The rest of the loop
Connections + CRS + dismiss, graph endpoint, contested/resolve + `routing_reviews`, change feed + ack, health scores + history + suggestions, profile + suggestions, export, permanent delete, deletion ops.

**Gate:** every change produces an event; contradictions mark pages contested and never overwrite; health factors explain why a score moved.

### Phase 4 — Public surfaces
Fern generation of TS SDK, Python SDK, CLI, and the 1:1 MCP server; OAuth connector with scopes and resources; public docs generated from the spec; webhooks.

**Gate:** an agent connects via MCP with only an API key and completes capture → search → read; the CLI can drive every operation; SDKs compile in CI.

### Phase 5 — Hardening
Isolation matrix, load test, provider-failure drills, budget caps, OTel dashboards, backup/restore rehearsal, OpenAPI compatibility diff at zero unexplained drift.

**Gate:** zero isolation failures, documented p95s, restore proven from backup.

### Phase 6 — Parity extras
Daily briefs, Slack (OAuth + channel bindings with `notifyBriefs`/`notifyConnections`/`notifyChanges`), Telegram bot, MCP Apps interactive search and graph, audio transcription.

### Phase 7 — Memtavi Studio (v2)
The ChatChat-equivalent: projects, agents, group chats (humans + agents), tool use and connected MCPs, scheduled tasks, agent skills, generated media, seats, credits, billing.

**Seams v1 must leave for Studio** — and this is why they are in the v1 schema now:
- `projects` above brains, with `kind ∈ {personal,team,production}`.
- Humans (`users`) distinct from end-user `subjects`, linked by `subject_links`.
- Org roles and seats already modelled in `memberships`.
- `usage_ledger` + `budget_caps` ready to become the credit system.
- An OAuth provider that Studio's connectors reuse.
- `packages/core` as an in-process service, so Studio calls the compiler directly instead of over HTTP.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| **Compiler quality is the product and the schedule.** API parity is mechanical; PFS patch quality is research. | Eval harness first; merge-safety set from day one; `review` band instead of forced merges. |
| OpenRouter model drift | Pin model IDs, `temperature: 0`, version prompts, record `model + promptHash` on every page version. |
| Embedding-space change breaks existing brains | `model` + `dimensions` on every embedding row; re-embed job; never mix models in one index. |
| Drop-in compatibility inherits quirks | Deliberate, documented in §2.3, covered by the shape-diff harness. |
| RLS mistakes with pooled connections | `SET LOCAL` inside the transaction only; fail-closed test; predicates remain primary. |
| Copying the reference spec | Re-author from behaviour; use their published spec only as a diff target. |
| pgvector recall under filters | Exact search first; benchmark against ground truth before enabling HNSW. |
| Cost blowout | Metered ledger, per-capture estimate, hard caps, kill switch. |
| Scope creep into Studio | v1 gate is explicit; Studio is Phase 7 and only starts after Phase 5 passes. |

---

## 15. Verification

After implementation, these are the commands and checks that prove the plan worked:

```bash
brew services start postgresql@18        # local Postgres; S3/CloudFront from infra/
bun install
bun run db:migrate
bun run dev                              # api
bun run dev:worker                       # worker
bun run dev:web                          # inspector

bun run typecheck
bun run test:unit
bun run test:integration                 # real Postgres
bun run test:isolation                   # must be zero failures
bun run test:contract                    # responses vs openapi.yaml
bun run spec:compat                      # shape-diff vs reference contract

bun run eval:locomo                      # accuracy, tokens, latency by type
bun run eval:merge-safety                # cross-entity merge rate
bun run bench:search --pages=10000       # p50/p95

bun run fern:generate                    # ts-sdk, python-sdk, cli, mcp
```

Manual end-to-end:

1. Create a brain; confirm a second tenant gets `404`.
2. Capture a URL and a note; watch `pending → compiling → completed`.
3. Open the page; click every claim and confirm it resolves to a chunk span.
4. Capture contradicting material; confirm the page becomes `contested` and both claims are visible.
5. Resolve it; confirm the change event records the resolution and the version history is intact.
6. Run the prompt index and a search; confirm an empty query returns `200 []`.
7. Edit a page by hand, then capture more material; confirm the compiler appends rather than overwrites.
8. Register a webhook; confirm signature verification and retry on a forced 500.
9. Connect via MCP with an API key; complete capture → search → read.
10. Delete a source; confirm pages remain. Delete a page with `permanent=true`; confirm cascade.

---

## 16. Storage and context economics (amendment)

This section supersedes the MinIO and docker-compose references in §4.1, §13 Phase 0 and §15. Implemented and verified 2026-11-06 against `infra/storage.yaml`.

### 16.1 Two-tier storage

Postgres keeps knowledge and evidence pointers. S3 keeps bulk text.

| Object | Where | Key |
|---|---|---|
| source body | S3 | `sources/<tenant>/<source>/<sha256>.txt` |
| chunk text | S3 | `chunks/<tenant>/<source>/<sha256>/<ordinal>.txt` |
| original upload | S3 | `originals/<tenant>/<source>/<sha256>.<ext>` |
| export archive | S3 | `exports/<tenant>/<brain>/<job>.zip` |

- `ingest_sources.body_ref`, `body_bytes`; `content` becomes a 4,000-character preview.
- `source_chunks.body_ref`; `text` becomes nullable.
- Keys are content-addressed and immutable; a changed body is a new object.
- `packages/storage` owns the SDK. `local`, `s3` and `fake` drivers behind one `ObjectStore` interface. No other package imports the AWS SDK.

### 16.2 AWS posture

- Private bucket, all four Block Public Access settings, Object Ownership enforced, no ACLs.
- SSE-S3, TLS-only bucket policy, CloudFront OAC scoped to one distribution.
- Viewer access only through CloudFront signed URLs; the private key is in SSM SecureString and `infra/.keys/<env>/` (gitignored).
- `PriceClass_200` (US/EU/Asia/ME/Africa). The default `*.cloudfront.net` certificate forces a TLSv1 minimum; pass `CertificateArn` (us-east-1) and `AliasDomain` to switch to `sni-only` with `TLSv1.2_2021`.
- CloudFront standard logging is off: the v1 path requires ACLs on the log bucket, which is deliberately ACL-free. S3 server access logs are on; use CloudFront standard logging v2 to CloudWatch Logs if request-level logs become necessary.
- Lifecycle: exports 7 days, originals 90 to Glacier IR then 365, noncurrent 30, abort multipart 7.
- IAM managed policies `memtavi-storage-worker-<env>` and `memtavi-storage-api-<env>`; no wildcard actions, no bucket-wide list.

### 16.3 Consent and proactive writes

- `memory_settings(tenant_id, subject_id, mode ∈ {auto, ask, off}, updated_by, updated_at)`, PK both. Per-scope override without changing the brain default; every change audited.
- `auto`: the agent writes without asking, under budget and MWS.
- `ask`: captures land in `pending_review` and surface in the inspector.
- `off`: capture returns `202` and stores nothing.
- MCP ships read-only first. The only write tool is `remember(claim, evidence, scope)`; there is no transcript tool.
- A prompt snippet ships with the server; the inspector shows what was remembered with one-click forget.

### 16.4 Token economics

- The prompt index returns summaries only (slug, summary, page type, pinned, `updatedAt`, page hash) inside a per-query token budget; `read` fetches a body on demand.
- Stable page hashes let an agent skip unchanged pages within a session.
- Caps per brain: pages, sources, storage bytes, from `budget_caps`.
- Retention by citation: a source cited by no page for 90 days loses its body, keeps its summary and hash.
- Version compaction: full bodies for the last 20 versions, summary + diff for older ones.

### 16.5 Metrics and eval gate

Per tenant: bytes stored per page, source-only ratio, duplicate-capture rate, tokens injected per answered task, pages read per task, monthly spend. The eval harness reports accuracy per 1k injected tokens; a prompt change that raises accuracy while multiplying tokens must be argued in the task.

### 16.6 Contract changes

- `IngestSource.content` becomes `contentPreview`; `contentUrl` is added (signed, expiring, `null` under the local driver).
- `GET /v1/brains/{brainId}/sources/{sourceId}/content` returns a signed URL, not a body.
- `memory_settings` and the `budget_caps` limits are added in migration `0008`.

### 16.7 Verification

```bash
MEMTAVI_AWS_ACCOUNT=209479287671 bash infra/deploy.sh dev
aws s3api get-public-access-block --bucket memtavi-media-dev-209479287671
curl -s -o /dev/null -w "%{http_code}" https://d2dmc3wnvzsf1d.cloudfront.net/<key>   # 403 unsigned
aws cloudfront sign --url ... --key-pair-id ... --private-key file://infra/.keys/dev/private.pem --date-less-than ...
```

An unsigned request must return `403`; a signed request must return the object; the bucket must report all four public-access blocks true.

