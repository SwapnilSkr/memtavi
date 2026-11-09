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

## Known limits

- The diff reads the spec, not live traffic. Response validation against the spec is not implemented yet; `bun run test:contract` is currently a placeholder that passes with no tests.
- Changing a `pattern` string is always flagged. The diff cannot prove that two regular
  expressions accept the same language.
- A business-rule change that keeps the wire shape, such as a new `409` condition, is invisible.
- Security is compared at scheme level: any new scheme is breaking and dropping one is
  non-breaking. Adding an unauthenticated `{}` alternative is not reported.
- A new required property is treated as breaking even in a response schema, where a strict reader
  might call it safe. The conservative reading keeps the rule table simple.
- Component schemas that nothing references are not compared; only reachable contract surface is.
