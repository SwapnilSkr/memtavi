import type { withTenant } from "@memtavi/db/client";
import { enqueueScoreSnapshot } from "@memtavi/db/health";
import {
  fetchDocument as defaultFetchDocument,
  postJson as defaultPostJson,
  FetchError,
  type FetchedDocument,
  type FetchFailureCode,
} from "@memtavi/fetch";
import type { ObjectStore } from "@memtavi/storage/types";
import type { PoolClient } from "pg";
import { compileCapture } from "./compile";
import { CONNECTION_CANDIDATES_SQL, discoverConnections } from "./connections";
import { snapshotScore } from "./health";
import { ingestCapture } from "./ingest";
import { purgeBrain } from "./purge";
import { sweepRetention } from "./retention";
import {
  type ClaimedJob,
  type CompilerConfig,
  type CompilerUsage,
  JobError,
  type JobHandler,
  type PostJson,
} from "./types";
import { deliverWebhook } from "./webhook";

export { RETENTION_BATCH_SIZE, RETENTION_CANDIDATES_SQL, sweepRetention } from "./retention";
export { CONNECTION_CANDIDATES_SQL };

const CLAIM_SQL = `
  UPDATE jobs
  SET status = 'running',
      attempts = attempts + 1,
      lease_until = now() + interval '60 seconds',
      last_error = NULL
  WHERE tenant_id = $2
    AND id = (
      SELECT id FROM jobs
      WHERE tenant_id = $2
        AND type = ANY($1::text[])
        AND (
          (status = 'pending' AND available_at <= now())
          OR (status = 'running' AND lease_until <= now())
        )
      ORDER BY (type = 'retention.sweep'), (type IN ('score.snapshot', 'connections.discover')),
        (type = 'connections.discover'), available_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
  RETURNING id, tenant_id AS "tenantId", brain_id AS "brainId", type, payload,
            attempts, max_attempts AS "maxAttempts"
`;

const COMPLETE_SQL = `
  UPDATE jobs SET status = 'completed', lease_until = NULL, last_error = NULL
  WHERE tenant_id = $1 AND id = $2
`;

const RETRY_SQL = `
  UPDATE jobs
  SET status = 'pending', lease_until = NULL,
      available_at = now() + make_interval(secs => $3), last_error = $4
  WHERE tenant_id = $1 AND id = $2
`;

const DEAD_SQL = `
  UPDATE jobs SET status = 'dead', lease_until = NULL, last_error = $3
  WHERE tenant_id = $1 AND id = $2
`;

const MAX_BACKOFF_SECONDS = 300;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_POLL_INTERVAL_MS = 1000;

const fetchMessages: Record<FetchFailureCode, string> = {
  invalid_url: "URL rejected",
  blocked_address: "URL target is not a public address",
  too_many_redirects: "Too many redirects",
  too_large: "Response body exceeds the size limit",
  timeout: "Fetch timed out",
  network: "Fetch failed",
};

export interface WorkerConfig {
  withTenant: typeof withTenant;
  tenantIds: string[];
  store: ObjectStore;
  compiler?: CompilerConfig;
  handlers?: Record<string, JobHandler>;
  fetchDocument?: (url: string) => Promise<FetchedDocument>;
  postJson?: PostJson;
  webhookSecretKey?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  random?: () => number;
  log?: (event: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface Worker {
  runOnce(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function backoffSeconds(attempts: number, random: () => number): number {
  const base = Math.min(MAX_BACKOFF_SECONDS, 2 ** attempts);
  return base + random();
}

function classify(error: unknown): {
  kind: "transient" | "permanent";
  message: string;
  code: string;
} {
  if (error instanceof JobError) return { kind: error.kind, message: error.message, code: "job" };
  if (error instanceof FetchError) {
    return {
      kind: error.retryable ? "transient" : "permanent",
      message: fetchMessages[error.code],
      code: error.code,
    };
  }
  return { kind: "transient", message: "Job failed", code: "internal" };
}

async function claimJob(
  client: PoolClient,
  tenantId: string,
  types: string[],
): Promise<ClaimedJob | null> {
  const result = await client.query<ClaimedJob>(CLAIM_SQL, [types, tenantId]);
  return result.rows[0] ?? null;
}

export function createWorker(config: WorkerConfig): Worker {
  const tenantIds = [...new Set(config.tenantIds.filter((id) => id.trim()))];
  if (tenantIds.length === 0) throw new Error("At least one tenant id is required");

  const handlers: Record<string, JobHandler> = config.handlers ?? {
    "capture.ingest": ingestCapture,
    "capture.compile": compileCapture,
    "connections.discover": discoverConnections,
    "review.apply": compileCapture,
    "score.snapshot": snapshotScore,
    "webhook.deliver": deliverWebhook,
    "brain.purge": purgeBrain,
    "retention.sweep": sweepRetention,
  };
  const types = Object.keys(handlers);
  if (types.length === 0) throw new Error("At least one job handler is required");

  const fetchDocument = config.fetchDocument ?? defaultFetchDocument;
  const postJson = config.postJson ?? defaultPostJson;
  const store = config.store;
  const concurrency = Math.max(1, Math.trunc(config.concurrency ?? DEFAULT_CONCURRENCY));
  const pollIntervalMs = Math.max(1, config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const random = config.random ?? Math.random;
  const log = config.log ?? (() => undefined);
  const withTenant = config.withTenant;

  const controller = new AbortController();
  const loops: Promise<void>[] = [];
  let stopping = false;
  let cursor = 0;

  async function claimNext(): Promise<ClaimedJob | null> {
    for (let offset = 0; offset < tenantIds.length; offset += 1) {
      const index = (cursor + offset) % tenantIds.length;
      const tenantId = tenantIds[index] ?? "";
      const job = await withTenant(tenantId, (client) => claimJob(client, tenantId, types));
      if (job) {
        cursor = (index + 1) % tenantIds.length;
        return job;
      }
    }
    return null;
  }

  async function process(job: ClaimedJob): Promise<void> {
    const startedAt = Date.now();
    const handler = handlers[job.type];
    try {
      if (!handler) throw new JobError("permanent", "Unknown job type");
      const context = {
        job,
        store,
        fetchDocument,
        withTenant,
        postJson,
        ...(config.webhookSecretKey === undefined
          ? {}
          : { webhookSecretKey: config.webhookSecretKey }),
        compiler: config.compiler,
        recordUsage: async (usage: CompilerUsage) => {
          await withTenant(job.tenantId, (usageClient) =>
            usageClient.query(
              `INSERT INTO usage_ledger
               (tenant_id, brain_id, job_id, provider, model, kind, input_tokens, output_tokens, cost_usd)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                job.tenantId,
                job.brainId,
                job.id,
                usage.provider,
                usage.model,
                usage.kind,
                usage.inputTokens,
                usage.outputTokens,
                usage.costUsd,
              ],
            ),
          );
        },
      };
      if (handler === discoverConnections) await discoverConnections(context);
      else if (handler === sweepRetention) {
        await sweepRetention({ ...context, ...(config.now ? { now: config.now } : {}) });
      } else await withTenant(job.tenantId, (client) => handler({ ...context, client }));
      await withTenant(job.tenantId, (client) =>
        client.query(COMPLETE_SQL, [job.tenantId, job.id]),
      );
      log({
        requestId: job.id,
        tenantId: job.tenantId,
        route: "worker",
        event: "job.completed",
        jobType: job.type,
        attempts: job.attempts,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const failure = classify(error);
      const dead = failure.kind === "permanent" || job.attempts >= job.maxAttempts;
      try {
        if (job.type === "capture.compile" && typeof job.payload.sourceId === "string") {
          await withTenant(job.tenantId, (client) =>
            client.query(
              `UPDATE ingest_sources SET status = 'failed', last_error = $4
             WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
               AND deleted_at IS NULL AND status <> 'completed'`,
              [job.tenantId, job.brainId, job.payload.sourceId, failure.message],
            ),
          );
        }
        if (dead) {
          await withTenant(job.tenantId, (client) =>
            client.query(DEAD_SQL, [job.tenantId, job.id, failure.message]),
          );
          if (job.type === "capture.compile") {
            await withTenant(job.tenantId, (client) =>
              enqueueScoreSnapshot(client, job.tenantId, job.brainId),
            );
          }
        } else {
          await withTenant(job.tenantId, (client) =>
            client.query(RETRY_SQL, [
              job.tenantId,
              job.id,
              backoffSeconds(job.attempts, random),
              failure.message,
            ]),
          );
        }
      } catch (recordError) {
        log({
          requestId: job.id,
          tenantId: job.tenantId,
          route: "worker",
          event: "job.record_failed",
          jobType: job.type,
          errorCode: classify(recordError).code,
          durationMs: Date.now() - startedAt,
        });
      }
      log({
        requestId: job.id,
        tenantId: job.tenantId,
        route: "worker",
        event: dead ? "job.dead" : "job.retry",
        jobType: job.type,
        outcome: dead ? "dead" : "retry",
        errorCode: failure.code,
        attempts: job.attempts,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  async function seedRetention(): Promise<void> {
    if (handlers["retention.sweep"]) {
      for (const tenantId of tenantIds) {
        await withTenant(tenantId, async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
            `retention:${tenantId}`,
          ]);
          await client.query(
            `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
               SELECT $1, b.id, 'retention.sweep', '{}', 'retention:' || gen_random_uuid()::text
               FROM brains b WHERE b.tenant_id = $1 AND b.deletion_state = 'active'
                 AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.tenant_id = $1
                   AND j.type = 'retention.sweep' AND j.status IN ('pending', 'running'))
               ORDER BY b.id LIMIT 1
               FOR SHARE OF b`,
            [tenantId],
          );
        });
      }
    }
  }

  async function runOnce(): Promise<boolean> {
    const job = await claimNext();
    if (!job) return false;
    await process(job);
    return true;
  }

  function wait(ms: number): Promise<void> {
    if (stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", done);
        resolve();
      }
      controller.signal.addEventListener("abort", done, { once: true });
      if (controller.signal.aborted) done();
    });
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      try {
        const worked = await runOnce();
        if (!worked) {
          await seedRetention();
          await wait(pollIntervalMs);
        }
      } catch (error) {
        log({
          requestId: null,
          tenantId: null,
          route: "worker",
          event: "poll.failed",
          errorCode: classify(error).code,
        });
        await wait(pollIntervalMs);
      }
    }
  }

  async function start(): Promise<void> {
    if (loops.length > 0) throw new Error("Worker already started");
    await seedRetention();
    for (let index = 0; index < concurrency; index += 1) loops.push(loop());
    await Promise.all(loops);
  }

  async function stop(): Promise<void> {
    stopping = true;
    controller.abort();
    await Promise.allSettled(loops);
  }

  return { runOnce, start, stop };
}
