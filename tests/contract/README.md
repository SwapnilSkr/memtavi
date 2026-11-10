# Contract tests

Two things live here: the frozen baseline used by `bun run spec:compat`, and the suite that
validates real responses against `packages/spec/openapi.yaml`.

## Baseline

`openapi.baseline.yaml` is a frozen copy of `packages/spec/openapi.yaml`. `bun run spec:compat`
diffs the current spec against it and fails CI on any breaking change. The diff is implemented
in `packages/spec/compat.mjs`; it resolves local `$ref`s before comparing.

Update flow:

1. Make the intended contract change in `packages/spec/openapi.yaml`.
2. If the change is intentionally breaking, run `bun run spec:baseline` in the same PR.
3. Explain the break and its client impact in the changelog.
4. Never edit `openapi.baseline.yaml` by hand. It must stay a byte-for-byte copy of the spec it
   was taken from, so the diff after an update is exactly the intended change.

## Response validation

`bun run test:contract` (`bun test tests/contract`) boots the real app in-process against a seeded
`memtavi_test` database and validates every response: the status must be documented, every
response must carry `x-request-id`, JSON responses must carry a JSON content type, and the body
must match the schema.

`api.test.ts` seeds through the API where it can and through the owner pool only for state the API
cannot create (pages, connections, change events, score snapshots). The shared harness is
`@memtavi/test-support`:

- `harness.ts` opens the owner and app pools, refuses a database whose name is not `memtavi_test`,
  imports `@memtavi/db/client` after pointing `APP_DATABASE_URL` at the app pool, builds the app
  with fake storage and a fixed clock, and bootstraps tenants A and B.
- `contract.ts` parses the spec once, follows response `$ref`s, compiles each (operation, status)
  schema once, and records what was validated. `createContract()` accepts an injected document so
  `contract.test.ts` can exercise the guards without a database.

### Strict mode

Before compiling, every object schema that declares `properties` and sets neither
`additionalProperties` nor `unevaluatedProperties` gets `unevaluatedProperties: false` on a deep
copy of the document. A response with an undocumented field therefore fails. Schemas that opt into
`additionalProperties: true` keep that behaviour, and `openapi.yaml` is never rewritten.

### The coverage guard

`afterAll` compares `contract.coverage()` (documented pairs with no validated response) against the
`UNEXERCISED` table. It fails when a pair is neither validated nor listed, and it also fails when a
listed pair was actually validated, so the table cannot hide new work.

- `UNEXERCISED` entries are `{ operationId, status, reason }`. `429`, `5xx`, unreachable `409` and
  `422` pairs, and operations with no route, are listed there with their reason.
- `KNOWN_DRIFT` entries record current behaviour that differs from the spec. The suite asserts
  today's behaviour through that table, and every item is a follow-up brief. Do not fix drift by
  editing the spec or a route in this suite.

### Adding an operation

1. Add it to the spec with `operationId`, a tag and every documented response.
2. Add a success call (and the reachable error calls) to `api.test.ts` with the exact path
   template, so the recorder sees the pair.
3. Run `bun run test:contract`. A missing pair fails the coverage guard; a shape mismatch fails the
   body check.
