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
