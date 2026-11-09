# Contract tests

`openapi.baseline.yaml` is a frozen copy of `packages/spec/openapi.yaml`. `bun run spec:compat`
diffs the current spec against it and fails CI on any breaking change. The diff is implemented
in `packages/spec/compat.mjs`; it resolves local `$ref`s before comparing.

## Update flow

1. Make the intended contract change in `packages/spec/openapi.yaml`.
2. If the change is intentionally breaking, run `bun run spec:baseline` in the same PR.
3. Explain the break and its client impact in the changelog.
4. Never edit `openapi.baseline.yaml` by hand. It must stay a byte-for-byte copy of the spec it
   was taken from, so the diff after an update is exactly the intended change.

`test:contract` is currently a placeholder that passes with no tests. Server-backed response
validation against the spec is still backlog; this directory only holds the baseline and this
note.
