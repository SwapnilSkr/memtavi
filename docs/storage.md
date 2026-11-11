# Storage

## Retention

The worker seeds one `retention.sweep` job for each configured tenant on startup and idle polls when no pending or running sweep exists. A tenant needs an active brain to anchor its job; idle polls pick up a tenant's first brain without a restart. Each leased job handles at most 50 sources, queues an immediate continuation while eligible work remains, and otherwise schedules the next sweep for one day later. Retention has the lowest claim priority. No request or external cron runs retention.

A completed source with no `page_sources` citations for strictly more than 90 days loses its stored body. Completion starts the clock, the last citation removal restarts it, and a new citation clears it. Legacy uncited sources receive a fresh 90-day grace period during migration because historical citation removal times were not recorded. Sources cited by any page, sources associated with pinned pages, and sources in deleting or deleted brains are protected.

Retention clears source previews, previews copied into capture idempotency receipts, source body references and byte counts, and chunk text and body references. It lists each source's exact `sources/`, `originals/`, and `chunks/` directories to find historical objects, and also collects references from source metadata and capture jobs. URL ingestion records replaced body references in `metadata.bodyRefs`. Source and chunk rows remain, along with source summary, hash, status, original byte count, and timestamps. Summaries use existing extracted claims without another model call; legacy summaries are preserved from `metadata.summary` when available. The source API returns an empty `contentPreview` and null `contentUrl`; the content URL endpoint returns the existing documented `404`.

The source's `body_dropped_at` and deletion key list commit before any object deletion. Failed or interrupted deletion is retried idempotently from that durable list, including after a worker restart. The list is cleared only after every delete succeeds; brain purge also collects it if a brain starts deleting during cleanup. Existing signed URLs may remain usable until their 300-second expiry or object deletion.

All built-in stores support directory listing; S3 needs `s3:ListBucket` for these prefixes as well as object deletion permissions. Custom stores must implement `ObjectStore.list` to run retention. An unsupported or failed listing leaves source bodies intact.

Existing deployments need a storage stack update from `infra/storage.yaml` before retention can list objects. The worker policy grants `s3:ListBucket` on the media bucket only when `s3:prefix` matches `sources/*`, `chunks/*`, or `originals/*`; bucket-wide listing remains disallowed.
