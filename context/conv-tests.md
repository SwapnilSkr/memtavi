---
id: conv-tests
when: writing a test, choosing a Done when, re-running verification
holds: What each suite must prove, the commands, and what is forbidden
links: conv-code, conv-compiler
---

# Test conventions

## The suites

| Suite | Proves | Runs against |
|---|---|---|
| `test:unit` | Pure core: policy bands, gap outcomes, fusion, state transitions, signatures | Nothing external |
| `test:integration` | Queries, transactions, leases, RLS, cascades | Real Postgres + pgvector |
| `test:contract` | Every response validates against `openapi.yaml` | Real API, seeded database |
| `test:isolation` | No tenant or subject can reach another's data | Real API, two seeded tenants |
| `spec:compat` | Our contract still matches the reference shapes | The two specs, no server |
| `eval:smoke` | The compiler still answers a small labelled set | Real providers, budget-capped |
| `bench:search` | p50/p95 at a stated page count | Seeded 10k-page brain |

## What each brief must name

- A compiler change names `eval:smoke` plus the metric that must not regress.
- A routing or policy change names the merge-safety set.
- A DB change names `test:integration` and the migration run on a fresh database.
- An API change names `test:contract` and `spec:compat`.
- A route or auth change names `test:isolation`.
- A UI change names the build, the type check, and the two viewport widths.

## Rules

- **Never call a real provider in unit or integration tests.** `FakeProvider` returns deterministic fixtures. A test that needs a model is an eval, not a unit test.
- No test may depend on wall-clock time or on iteration order. Pass a clock and sort.
- A test asserts behaviour, not implementation: no snapshot of a whole object where three fields matter.
- A bug fix lands with the test that would have caught it. The test is named for the behaviour, not the ticket.
- Table-driven where the cases differ only in input and expected output.
- Every test that touches tenancy asserts the negative case first: the foreign id returns `404` and no row is read.
- A timeout is a failure, not a skip. No `test.skip` without a line in `gl-decisions`.

## Forbidden

- `sleep` to wait for a job. Poll the queue with a bounded deadline.
- A test that deletes production or shared data. Integration tests use a disposable database.
- A green run reported from a subset of the suite when the brief named the whole suite.

## Reporting

Paste the command and its real output. If a suite cannot run because a dependency is missing, say so and stop; do not substitute a narrower command silently.
