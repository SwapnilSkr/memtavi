# Benchmarks

## FTS under RLS — 2026-11-11

Command: `bun run bench:search`, with `TEST_DATABASE_URL` and `TEST_APP_DATABASE_URL` already loaded. All migrations and the unit, integration, isolation and contract suites ran against a newly created disposable database first. PostgreSQL 18.6 (Homebrew), local TCP, macOS 15.7.9. Hardware details from the earlier baseline were not re-probed because the sandbox denied `sysctl`. The data shape, 10,000-page brain, 5 warmups, 30 measured queries, limit 20 and app-role `withTenant` transactions are unchanged.

The keyword path now calls `public.search_pages_keyword(text, text, integer)`. This stable `SECURITY DEFINER` function uses the table owner's GIN access path while explicitly enforcing the transaction's tenant, optional subject, requested brain and active deletion state. Its pinned search path and app-only execute grant follow `list_members`. The existing page RLS policy checks tenant only; an absent or empty subject therefore retains tenant-only visibility. When a subject is present, the function additionally requires that subject. API search still checks the subject-scoped brain before invoking it; MCP reaches the same API endpoint.

Wall time per scoped query, milliseconds:

| Query | count | mean | p50 | p95 | max |
|---|---|---|---|---|---|
| Keyword function, ranked FTS, limit 20 | 30 | 2.063 | 1.862 | 3.341 | 3.697 |
| Exact vector, limit 20 | 30 | 44.405 | 43.003 | 46.038 | 78.137 |

`pages_search_tsv_gin.idx_scan` increased **7 → 42 (+35)**: one scan for each warmup and measured keyword query. Statistics were explicitly flushed from the app backend before reading the counter; the initial seven scans came from the preceding integration suite. Relation totals were 14,827,520 B for `pages` (10,493,952 B indexes), and 85,606,400 B for `page_embeddings` (958,464 B indexes).

A separate fresh-database `bun run bench:search --keep` run measured FTS p50 **1.657 ms**, p95 **4.040 ms**, and GIN scans **0 → 35 (+35)**. Vector p50 was 42.668 ms, p95 45.775 ms. The retained fixture was used for the plans below, then its disposable database was dropped. Treat these as local samples, not a throughput guarantee or a controlled speedup comparison against the older baseline.

On that same 10k fixture, the previous direct query as `memtavi_app` still produces `Seq Scan on pages`, removes 9,900 rows, hits 531 buffers and takes 2.103 ms under `EXPLAIN (ANALYZE, BUFFERS)`. The function call's outer plan is:

```text
Function Scan on search_pages_keyword  (cost=0.25..10.25 rows=1000 width=172) (actual time=1.185..1.187 rows=20.00 loops=1)
  Buffers: shared hit=341
Planning Time: 0.008 ms
Execution Time: 1.205 ms
```

`EXPLAIN` normally hides a definer function's body. `auto_explain` was loaded and configured by the database owner, then the session used `SET LOCAL ROLE memtavi_app` and transaction-local tenant/subject settings before invoking `EXPLAIN (ANALYZE, BUFFERS)` on the real function. Nested-statement logging captured this inner plan; `enable_seqscan=on`, with no planner override:

```text
Limit  (cost=966.69..966.74 rows=20 width=120) (actual time=0.915..0.916 rows=20.00 loops=1)
  Buffers: shared hit=268
  ->  Sort  (cost=966.69..966.94 rows=100 width=120) (actual time=0.914..0.915 rows=20.00 loops=1)
        Sort Key: (ts_rank(search_tsv, '''alpha42'''::tsquery)) DESC, slug, id
        Sort Method: top-N heapsort  Memory: 28kB
        Buffers: shared hit=268
        ->  Bitmap Heap Scan on pages p  (cost=706.06..964.02 rows=100 width=120) (actual time=0.749..0.833 rows=100.00 loops=1)
              Recheck Cond: (search_tsv @@ '''alpha42'''::tsquery)
              Filter: ((brain_id = 'brn_1441fae068ab450db66fb3c41138d07f'::text) AND (deletion_state = 'active'::public.deletion_state) AND (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND ((NULLIF(current_setting('app.subject_id'::text, true), ''::text) IS NULL) OR (subject_id = (NULLIF(current_setting('app.subject_id'::text, true), ''::text))::uuid)))
              Heap Blocks: exact=100
              Buffers: shared hit=268
              ->  Bitmap Index Scan on pages_search_tsv_gin  (cost=0.00..706.04 rows=100 width=0) (actual time=0.736..0.736 rows=100.00 loops=1)
                    Index Cond: (search_tsv @@ '''alpha42'''::tsquery)
                    Index Searches: 1
                    Buffers: shared hit=166
```

The integration test inspects the nested JSON plan for `Bitmap Index Scan` on `pages_search_tsv_gin`, and separately proves foreign tenant/subject/brain exclusion, missing/empty tenant failure, deletion filtering, PUBLIC execution denial and parity with the prior ranking and result columns. No built-in was marked leakproof and page RLS remains enabled. The vector path is unchanged.

## Search — 2026-11-09

Command:

```bash
TEST_DATABASE_URL=postgres://memtavi:memtavi@localhost:5434/memtavi_test \
TEST_APP_DATABASE_URL=postgres://memtavi_app:memtavi_app@localhost:5434/memtavi_test \
bun run bench:search --pages=10000
```

Environment:

- Hardware: MacBook Pro (Mac16,8), Apple M4 Pro, 12 cores (8 performance, 4 efficiency), 24 GB RAM, macOS 15.7.9.
- PostgreSQL 18.6 (Homebrew), local TCP on port 5434, default configuration.
- Data: 10,000 synthetic pages in one brain; one `text-embedding-3-small` embedding (1536 dimensions) per page. Title `Synthetic page N`, summary `alpha<N mod 100>`, body an md5 digest.
- Method: 30 queries after 5 warmups. Every query ran through `withTenant` as `memtavi_app` with RLS enforced (not superuser, does not bypass RLS).
- Date: 2026-11-09.

Results, wall time per scoped query in milliseconds:

| Query | count | mean | p50 | p95 | max |
|---|---|---|---|---|---|
| Weighted FTS, `websearch_to_tsquery('english', 'alpha<k>')`, ranked, limit 20 | 30 | 3.068 | 2.307 | 8.605 | 10.964 |
| Exact vector, `embedding <=> $1`, limit 20 | 30 | 40.866 | 40.148 | 45.908 | 50.668 |

Relation and index sizes:

| Relation | Total (`pg_total_relation_size`) | Indexes (`pg_indexes_size`) |
|---|---|---|
| `pages` | 14,843,904 B (14.2 MiB) | 10,510,336 B (10.0 MiB) |
| `page_embeddings` | 85,606,400 B (81.6 MiB) | 958,464 B (936 KiB) |

`pages_search_tsv_gin` is about 3.2 MB of the `pages` index total; the `pages` heap is about 4 MiB.

Verification run (same machine, same data shape, a few minutes later): FTS `p50 2.344 / p95 5.047 ms`, vector `p50 39.439 / p95 43.08 ms`. Treat the table above as one sample; the honest range at 10k is **FTS p95 5–9 ms, vector p95 43–46 ms**.

## Historical interpretation — 2026-11-09

The FTS query is a sequential scan under the app role, not a GIN index scan. The same statement as the table owner uses `pages_search_tsv_gin`:

```
Limit  (cost=270.98..271.03 rows=20 width=54) (actual time=0.751..0.754 rows=20.00 loops=1)
  Buffers: shared hit=110
  ->  Sort  (cost=270.98..271.23 rows=100 width=54) (actual time=0.750..0.751 rows=20.00 loops=1)
        Sort Method: top-N heapsort  Memory: 28kB
        ->  Bitmap Heap Scan on pages p  (cost=13.35..268.31 rows=100 width=54) (actual time=0.080..0.516 rows=100.00 loops=1)
              Recheck Cond: (search_tsv @@ '''alpha42'''::tsquery)
              Heap Blocks: exact=100
              ->  Bitmap Index Scan on pages_search_tsv_gin  (cost=0.00..13.33 rows=100 width=0) (actual time=0.036..0.036 rows=100.00 loops=1)
                    Index Cond: (search_tsv @@ '''alpha42'''::tsquery)
Execution Time: 0.844 ms
```

As the app role, with RLS enforced, the plan is:

```
Limit  (cost=752.92..752.97 rows=20 width=54) (actual time=5.538..5.542 rows=20.00 loops=1)
  Buffers: shared hit=531
  ->  Sort  (cost=752.92..753.17 rows=100 width=54) (actual time=5.537..5.539 rows=20.00 loops=1)
        Sort Method: top-N heapsort  Memory: 28kB
        ->  Result  (cost=0.01..750.26 rows=100 width=54) (actual time=0.061..5.280 rows=100.00 loops=1)
              One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '...'::uuid)
              ->  Seq Scan on pages p  (cost=0.01..750.01 rows=100 width=151) (actual time=0.052..5.234 rows=100.00 loops=1)
                    Filter: ((tenant_id = '...'::uuid) AND (subject_id = '...'::uuid) AND (brain_id = '...'::text) AND (deletion_state = 'active'::deletion_state) AND (search_tsv @@ '''alpha42'''::tsquery))
                    Rows Removed by Filter: 9900
Execution Time: 5.571 ms
```

The `@@` operator calls `ts_match_vq`, which is not leakproof. The RLS policy is a security barrier, so the non-leakproof predicate is not pushed into the GIN index and the scan becomes sequential. `pg_stat_user_indexes.idx_scan` for `pages_search_tsv_gin` is 0 after these runs. The measured 2.31 ms p50 is the cost of scanning the ~4 MiB heap, not an index seek. The scoped definer function measured above now makes the GIN path reachable without changing built-in leakproof flags or page RLS.

The vector query is a sequential scan of `page_embeddings`, a hash join to `pages`, and a top-N sort. There is no ANN index, by design. The plan touched 30,764 shared buffers and `EXPLAIN ANALYZE` reported 71.2 ms; the benchmark's 40.1 ms p50 does not include `EXPLAIN` instrumentation overhead.

Vector plan as the app role (the 1536-dimension literal in the sort key is abbreviated to `$4`):

```
Limit  (cost=1530.37..1530.42 rows=20 width=58) (actual time=71.119..71.122 rows=20.00 loops=1)
  Buffers: shared hit=30764
  ->  Sort  (cost=1530.37..1555.37 rows=10000 width=58) (actual time=71.118..71.119 rows=20.00 loops=1)
        Sort Key: (e.embedding <=> $4::vector), p.slug, p.id
        Sort Method: top-N heapsort  Memory: 28kB
        ->  Result  (cost=488.01..1264.27 rows=10000 width=58) (actual time=6.456..66.049 rows=10000.00 loops=1)
              One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '...'::uuid)
              ->  Hash Join  (cost=488.01..1239.27 rows=10000 width=68) (actual time=6.352..11.939 rows=10000.00 loops=1)
                    Hash Cond: (p.id = e.page_id)
                    ->  Seq Scan on pages p  (cost=0.00..725.00 rows=10000 width=66) (actual time=0.012..2.053 rows=10000.00 loops=1)
                    ->  Hash  (cost=363.00..363.00 rows=10000 width=70) (actual time=6.067..6.067 rows=10000.00 loops=1)
                          ->  Seq Scan on page_embeddings e  (cost=0.00..363.00 rows=10000 width=70) (actual time=0.011..3.087 rows=10000.00 loops=1)
Execution Time: 71.220 ms
```

## Reproducing

The benchmark refuses any database not named `memtavi_test*`, requires both URLs, and asserts that the app role differs from the owner role and cannot bypass RLS. It deletes its tenant unless `--keep` is passed. It is deliberately not wired into CI or the default test suites.
