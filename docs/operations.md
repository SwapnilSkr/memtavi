# Operations

## Provider failures

The compile job is the only worker path that calls a model, and it maps a provider failure to one of two job outcomes. `ProviderError` carries its own `transient` flag: a 429, a 5xx, a timeout and a network reset are transient, everything else is permanent. A compile-schema failure (extraction or patch output that does not parse) raises `CompileError` and is always permanent.

| Failure | Job | Source | Writes |
|---|---|---|---|
| 429 at extraction | `pending`, attempts + 1, `available_at` moved forward by exponential backoff with jitter | `pending` with `lastError`, then `completed` on the retry | The failing attempt writes nothing; `usage_ledger` holds only the calls that returned |
| Timeout at the patch call | `pending`, attempts + 1, `available_at` moved forward | `pending` with `lastError`, then `completed` on the retry | The transaction rolls back: no page update, version, change event, outbox row or embedding survives |
| Server error at page embedding | `pending`, attempts + 1, `available_at` moved forward | `pending` with `lastError`, then `completed` on the retry | Same rollback; the patch is not recorded even though its chat call completed |
| Malformed extraction JSON | `dead` on the first attempt | `failed` with `Invalid compiler output` | No retry scheduled; only the extraction call is billed |
| Transient that never clears | `dead` once `attempts >= max_attempts` | `failed` with `Compiler provider failed` | Whatever the last attempt incurred is billed; nothing partial is committed |

The source follows the job: while a retry is queued the source is `pending` with the client-safe message in `lastError`, and it is `failed` only once the job is dead — a permanent error or `attempts >= max_attempts`. A manual `POST /v1/brains/{brainId}/sources/{sourceId}/retry` is accepted only for a `failed` source, so pressing Retry during backoff answers `409` and enqueues nothing; the pending attempt keeps its single `capture.compile` job.

Retry copies `lastError = "Compiler provider failed"` and never the provider's response body, so a client sees a stable message rather than an upstream payload. `available_at` is `min(300s, 2^attempts) + random()`, so a drill or an operator can drive the clock by moving `available_at` rather than sleeping.

Every compile stage runs inside one `withTenant` transaction. A provider error thrown anywhere after the first write rolls that transaction back, which is why a partial page, version, embedding, change event, `webhook_events` row or `webhook_deliveries` row cannot survive a failed attempt. `usage_ledger` is written through `recordUsage` on its own connection, so a billed call is recorded even when the compile it belonged to rolls back; it is never written twice for one call.

`tests/integration/provider-drills.test.ts` proves each row against a real Postgres and the real worker, asserting the job state, attempts, backoff, source status and `lastError`, and that counts of `pages`, `page_versions`, `page_sources`, `page_embeddings`, `change_events`, `webhook_events`, `webhook_deliveries` and the compile's `webhook.deliver` jobs match the pre-run snapshot. `FakeProvider` supports the drills through `queueChat(...)` and `queueEmbed(...)`, both of which accept a `ProviderError` and throw it once, in queue order, leaving later queued responses intact.

## Telemetry

Traces are off by default. With no `OTEL_EXPORTER_OTLP_ENDPOINT` the API and the worker register no provider and every helper falls through to the OpenTelemetry no-op API, so no spans are created and nothing is exported.

Set these on both processes:

| Variable | Meaning |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL. `/v1/traces` is appended when the path is absent. |
| `OTEL_SERVICE_NAME` | `service.name` on every span. Defaults to `memtavi`. |
| `OTEL_TRACES_SAMPLER` | `always_on`, `always_off`, `traceidratio`, `parentbased_always_on` (default), `parentbased_always_off` or `parentbased_traceidratio`. |
| `OTEL_TRACES_SAMPLER_ARG` | Sampling ratio for the `*traceidratio` samplers, 0 to 1. |

Point it at a local collector:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=memtavi-api \
bun run start:api
```

Both processes export over OTLP/HTTP in batches and flush pending spans at shutdown. The OpenTelemetry JS SDK, its `AsyncLocalStorage` context manager and the OTLP HTTP exporter run under Bun 1.3.5; no auto-instrumentation package is used, so every span listed below is created by this code explicitly.

One trace connects the whole path:

| Span | Created by | Attributes |
|---|---|---|
| `POST /v1/brains/:brainId/captures` | API request middleware | `http.request.method`, `http.route`, `http.response.status_code`, `request.id` |
| `job capture.ingest` / `job capture.compile` | worker, one per attempt | `job.id`, `job.type`, `job.attempt`, `job.outcome`, `job.error_code` on failure |
| `provider.chat` / `provider.embeddings` | provider HTTP clients | `provider`, `model`, `input_tokens`, `output_tokens`, `status_code`, `error_type` on failure |

The server span carries the `x-request-id` header as `request.id`, and the JSON request log line carries the same trace id as `traceId`. When the API or the worker enqueues a job inside a request or job span, a `BEFORE INSERT` trigger on `jobs` copies the active W3C `traceparent` from the transaction-local `app.traceparent` setting into `jobs.trace_context`; the worker reads it on claim and starts its job span as the child of that remote span. The setting is `SET LOCAL`, so a pooled connection cannot leak one tenant's trace context into the next transaction. Every request runs inside its own async scope, opened at the Elysia `fetch` boundary, so concurrent requests cannot see each other's active span; `tests/integration/telemetry.test.ts` sends two captures concurrently and asserts distinct trace ids with matching job parents. Writing `app.traceparent` is part of `withTenant` in `@memtavi/db/client`, so the API, the worker and the tests share one implementation.

No header, body, API key, subject id, prompt, completion or query string is written to a span attribute. `tests/integration/telemetry.test.ts` asserts the redaction. DB client spans are not created; adding them would require parameterised statement text only.
