# API compatibility

`bun run spec:compat` diffs `packages/spec/openapi.yaml` against the frozen baseline in
`tests/contract/openapi.baseline.yaml`. Any breaking finding exits `1`, so CI fails before a
client can see the change. `bun run spec:compat --json` prints the findings array instead of the
summary.

Every finding is `{ severity, path, message }`, where `path` is a JSON Pointer into the new spec.
The list is sorted: breaking findings first, then by path.

## Rules

Breaking:

| Change | Note |
|---|---|
| Removed path, method or parameter. | The client can no longer call it. |
| Added required parameter, or any `in: path` parameter. | Existing calls stop validating. |
| Parameter or schema `type` changed. | Compared as a set, so 3.1 `type` arrays are order-insensitive. |
| `format` changed or removed. | A different wire format, or a lost guarantee. |
| Enum narrowed, or an enum constraint added. | Existing values may be rejected. |
| New required property, or a property became required. | Existing bodies may omit it. |
| Removed property, including from a response. | The client may read it. |
| Removed `oneOf`/`anyOf` variant, or a new variant constraint. | A shape the client could send or receive is gone. |
| Bounds tightened, or a `pattern` added or changed. | Existing values may be rejected. |
| Added security requirement. | Existing callers cannot authenticate. |
| Removed request or response content type. | Negotiation that worked stops working. |
| Removed response code. | Documented behaviour disappears. |
| Request body became required. | Existing calls may omit it. |

Non-breaking:

| Change | Note |
|---|---|
| Added path or method. | |
| Added optional parameter. | |
| Added optional property. | |
| Added enum value. | |
| Added response code or content type. | |
| Removed security requirement. | |
| Removed bounds, `pattern`, enum or requiredness. | A relaxation. |
| Added optional request body, or it became optional. | |
| Added `oneOf`/`anyOf` variant. | |

## `$ref` handling

Local `#/...` references are resolved before comparison, including references inside parameters,
request bodies, responses, headers and schemas. Renaming a component with the same shape therefore
produces no findings. Recursion is cut by tracking the pair of resolved objects on the current
comparison path, so a self-referential schema terminates instead of hanging.

## Baseline flow

1. Change the spec.
2. Run `bun run spec:compat` and review the findings.
3. If the break is intentional, run `bun run spec:baseline` in the same PR and explain the break
   and its client impact in the changelog.
4. Never edit `tests/contract/openapi.baseline.yaml` by hand.

## Baseline updates

2026-11-10 — **Removed response codes the API never returns.** The baseline was refreshed with the
following deliberate removals, so `spec:compat` reports them once here instead of on every run:

- `422` on eight operations (`createBrain`, `createCapture`, `updatePage`, `searchBrain`,
  `ackConnection`, `ackChange`, `updateProfile`, `createApiKey`). The error middleware maps a
  schema validation failure to `400`, and no other handler on these operations raises a `422`, so
  no client could have received one. `createWebhook` keeps its `422`: `validateEvents` in
  `apps/api/src/lib/webhooks.ts` raises it for duplicate events and for an event outside
  `WEBHOOK_EVENTS`, and `test:contract` now exercises both.
- `409` on `createWebhook`, `createApiKey` and `updateBrain`. No handler has a conflict path for
  these operations, so the status was never produced.
- `404` on `getTenant`. Only an owner key reaches the handler and an owner key always carries its
  tenant, so the status was never produced.

No client breaks: a status that was never sent cannot be depended on, and every removal only makes
the documented surface smaller. The same change adds `400` to the thirteen operations that reject a
malformed `x-subject-id` and `403` to `updateBrain`, `deleteBrain` and `listMembers`, all
non-breaking additions.

## Response validation

`bun run test:contract` drives every operation in `packages/spec/openapi.yaml` through the real app
against a seeded `memtavi_test` database and validates each response against the spec. It runs in CI
after `test:isolation`.

`tests/support` is the shared harness: `@memtavi/test-support/harness` boots the app with fake
storage and a fixed clock and bootstraps two tenants; `@memtavi/test-support/contract` loads the
spec once, resolves response `$ref`s, compiles each (operation, status) schema once, and records
which pairs were validated.

Strict mode adds `unevaluatedProperties: false` to every object schema that declares `properties`
and sets neither `additionalProperties` nor `unevaluatedProperties`, on a deep copy of the spec. A
response carrying a field the spec does not document fails. Schemas that set
`additionalProperties: true` keep that escape hatch. `openapi.yaml` is never modified.

The coverage guard fails the suite when a documented (operation, status) pair has no validated
response. Two named lists keep the suite green without hiding work:

- `UNEXERCISED` in `tests/contract/api.test.ts`: documented pairs the suite cannot produce, each
  with a reason. Every entry must still be a gap, so it cannot silently cover a regression.
- `KNOWN_DRIFT` in the same file: current behaviour that differs from the spec. The test asserts
  today's behaviour through that list, and every item is a follow-up brief.

Adding an operation:

1. Add it to the spec with `operationId`, a tag and every documented status.
2. Add its route and add a success call plus the reachable error calls to
   `tests/contract/api.test.ts`.
3. Run `bun run test:contract`. A missing validated pair fails the coverage guard.

## Known limits

- The diff reads the spec, not live traffic. The strict response checks live in
  `bun run test:contract`, not in `spec:compat`.
- Changing a `pattern` string is always flagged. The diff cannot prove that two regular
  expressions accept the same language.
- A business-rule change that keeps the wire shape, such as a new `409` condition, is invisible.
- Security is compared at scheme level: any new scheme is breaking and dropping one is
  non-breaking. Adding an unauthenticated `{}` alternative is not reported.
- A new required property is treated as breaking even in a response schema, where a strict reader
  might call it safe. The conservative reading keeps the rule table simple.
- Component schemas that nothing references are not compared; only reachable contract surface is.
