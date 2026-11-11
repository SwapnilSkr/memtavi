---
id: conv-code
when: writing or reviewing any TypeScript in this repo
holds: Language, module layout, error handling, logging, naming
links: conv-tests
---

# Code conventions

TypeScript everywhere. Bun is the runtime. `tsconfig` is strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any` in `packages/core`; `unknown` plus a schema parse at the boundary.

## Layout

Pure domain logic goes in `packages/core` and must not import HTTP, the ORM, or a provider SDK. Adapters live in `packages/db`, `packages/llm`, `apps/*`. A route does four things and no more: validate, call core, map the result, map the error.

```
apps/api/src/routes/*      route definitions only
apps/api/src/middleware/*  auth, scope, request-id, errors, rate limit
packages/core/*            pure functions; no I/O
packages/db/*              schema, queries, transactions
packages/llm/*             provider interface + implementations
```

Cross a package or app boundary only through a `@memtavi/*` export; add one to that package's `exports` rather than importing `../../packages/x/src` or another app's source. Shared queries belong in `packages/db`.

## Errors

- One error type per domain concern, carrying `code`, `status`, and a client-safe `message`.
- Unknown errors become a `500` with a generic message. Never leak a stack, a SQL fragment, or a provider response body to a client.
- A `404` is also the answer for a resource owned by another tenant. Do not add a `403` that reveals existence.
- Provider and fetch failures are classified `transient` or `permanent`. Only `transient` is retried.

## Naming and shape

- `camelCase` values, `PascalCase` types, `snake_case` database columns.
- API JSON field names are `camelCase` and are frozen by `packages/spec`; do not rename a field to match internal preference.
- IDs are prefixed strings (`brn_`, `src_`, `pg_`, `cnn_`, `chg_`) generated in `packages/shared/ids.ts`. Never expose a raw UUID where the reference product exposes a prefix.
- Timestamps are ISO 8601 UTC strings at the boundary, `timestamptz` in the database.

## Logging

- Structured only, through `packages/shared/logging.ts`. No `console.log` in `apps/*` or `packages/*`.
- Every line carries `requestId`, `tenantId`, and `route`. Never log a page body, a source body, an API key, or a provider prompt.
- Log the outcome and the duration, not the payload.

## Hygiene

- No comments that restate the code. A comment is allowed only for a non-obvious invariant or a deliberate compatibility quirk, and it must name the reason.
- No barrel files that re-export a whole package; import the module directly.
- No new helper for a single call site. Three similar lines beat a premature abstraction.
- Delete rather than deprecate. No `_unused` renames and no "removed" comments.
- Format with the repo formatter; do not reformat lines you did not change.
