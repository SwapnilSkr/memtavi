# HTTP isolation matrix

`bun run test:isolation` runs two suites against a seeded `memtavi_test` database: the
database-level RLS suite in `tests/isolation/tenant.test.ts` and the HTTP matrix in
`tests/isolation/http.test.ts`.

## What the matrix proves

Every operation in `packages/spec/openapi.yaml` is driven through the real app with another
tenant's id, another subject's id, and another subject's child ids. A foreign id must answer
`404` with the reference error envelope and `x-request-id`, the body must contain none of the
foreign resource's ids, slugs, titles or other values, and the foreign rows must be identical
before and after the request. Lists and reads taken as the owning subject must not mention any
foreign id, slug or title.

The before/after snapshot is built from the database catalog, not a hand list. In `beforeAll`
the suite reads `information_schema.columns`, keeps every `public` base table with a `tenant_id`
column, and aggregates that table's rows for the scoped tenant as ordered `jsonb`. Tables with a
`subject_id` are filtered by it; otherwise a `brain_id` or `page_id` column narrows the rows to
the subject's brains or pages; the rest are tenant-wide. Identifiers come only from the catalog
and are checked against a lowercase identifier allowlist before being quoted, so a new table is
covered on the next run. `api_keys.last_used_at` is the only excluded column: the auth middleware
touches the caller's key on every request, including a denied one, so it is not evidence of a
write by the operation under test.

## Case types

| Case | Request |
|---|---|
| `foreign-tenant` | Tenant B's id with tenant A's key and subject. |
| `foreign-subject` | Subject A2's brain id, or A2's webhook id, with tenant A's key and subject A1. |
| `foreign-child-a2` / `foreign-child-b` | A1's brain id with A2's or B's `slug`, `sourceId`, `connectionId` or `changeId`. |
| `tenant-scoped` | B's `webhookId` or `keyId` with tenant A's key. |
| `own-list` | A list or read taken as A1; no foreign marker may appear. |
| `auth-missing-key`, `auth-unknown-key`, `auth-revoked-key`, `auth-malformed-subject` | The four auth negatives; nothing may be written. |

`tests/isolation/matrix.ts` builds the cases from the spec: it enumerates every operation,
classifies each path parameter by name, and emits the case types that apply. `fixtures.ts` seeds
subject A1, subject A2 and tenant B, each with a brain, pages, a source, a connection, a change
and (per subject) a webhook, plus one extra API key per tenant. Snapshots read through the owner
pool and compare row content and tenant-wide counts.

## Adding an operation

Add it to the spec and its route. The matrix picks it up on the next run: `brainId` earns the
foreign tenant and subject cases, each child id earns the foreign-child cases, `webhookId` earns
the tenant-scoped and foreign-subject cases, `keyId` earns the tenant-scoped case only because
API keys are tenant-level, and every operation earns the four auth negatives. An operation with
no id, or one whose route does not exist yet, must be named in `EXEMPT` with a reason. The
`afterAll` guard fails when an operation has no case and no exemption, or when an exemption has
gone stale.

## Stop on leak

A green matrix is a gate, not a fix. If a case fails, stop extending the matrix, keep the failing
case, and report the route, case and response in the task report. The fix is a separate brief;
this suite never changes `apps/**` or `packages/**`.
