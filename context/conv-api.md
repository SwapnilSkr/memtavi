---
id: conv-api
when: touching apps/api or packages/spec
holds: Spec-first contract, wire compatibility, error envelope, pagination, idempotency
links: conv-code, conv-security, conv-tests
---

# API conventions

## The spec is the source of truth

`packages/spec/openapi.yaml` (OpenAPI 3.1) is authored first. Routes implement it. Fern generates the TypeScript SDK, Python SDK, CLI and the API-key MCP server from it. A change that alters a path, a parameter, a field name, an enum or a status code is a **contract change** and must be made in the spec in the same task.

`openapi.yaml` is never generated from decorators and then trusted. `bun run test:contract` validates every real response against it, and `bun run spec:compat` diffs our spec against the reference product's published contract. Unexplained drift fails the build.

## Wire compatibility is deliberate

Paths, field names, enums and headers match the reference product so an existing client can point at us by changing only the base URL. Keep these quirks:

- `404`, never `403`, for a brain owned by another subject.
- `DELETE /pages/{slug}` requires `permanent=true`. It is a confirmation, not a soft-delete flag.
- `GET /pages/{slug}` bumps `lastReferencedAt`. It is a consumption signal, not a list hydrator.
- Keyword matches bypass `minSimilarity`; semantic-only matches do not.
- `similarity` carries the vector score only, so a result list can appear out of similarity order.
- `deprecated` (system-superseded, recoverable) is distinct from `archived` (user-retired, restorable).
- Deleting an ingest source leaves derived pages in place.

Any of these that we decide to change gets a line in `gl-decisions` and a compat-harness exception. It never changes silently.

## Envelope and headers

Every response echoes `x-request-id`. Every error uses the reference shape:

```json
{ "statusCode": 404, "timestamp": "2026-11-06T10:00:00.000Z", "path": "/v1/brains/brn_1",
  "message": "Not found", "body": { "message": "Not found", "error": "NotFoundError", "statusCode": 404 } }
```

Two required request headers:

| Header | Meaning |
|---|---|
| `x-api-key` | The caller. Tenant-scoped, carries a role. |
| `x-subject-id` | The end user, a UUID. Determines which brains are visible. |

Missing key → `401 Missing API key`. Unknown or revoked key → `401 Invalid API key`. Malformed subject → `400`.

## Pagination and limits

- Lists return `{ items, total, limit, offset }` with offset pagination, matching the reference.
- Default page size 50, max 200.
- `429` carries `Retry-After`. Defaults: 300 req/min per key, 120 req/min per MCP session.
- Capture endpoints honour `Idempotency-Key`, persisted for 24 hours and replayed byte-for-byte.

## Status codes

| Code | Use |
|---|---|
| `200` | Read succeeded, including an empty list |
| `201` | A resource was created or a command was accepted |
| `400` | Malformed body, wrong enum, both `content` and `fetchUrl` |
| `401` | Missing or invalid key |
| `404` | Not found, or not yours |
| `409` | Version conflict on a page edit |
| `429` | Rate limited |
| `5xx` | Ours. Never used for a provider's error |

## Adding an endpoint

1. Add it to the spec with `operationId`, tag, all response codes and example bodies.
2. Add the route, the middleware scope and the contract test in the same task.
3. Regenerate the SDKs and CLI if any generated surface changed, and commit the regenerated output.
4. If the endpoint calls a model, it belongs on the queue, not in the request.
