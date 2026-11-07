import { createWorker } from "./worker";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!process.env.APP_DATABASE_URL) throw new Error("APP_DATABASE_URL is required");

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error("Invalid WORKER_CONCURRENCY");
}

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000);
if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
  throw new Error("Invalid WORKER_POLL_INTERVAL_MS");
}

const tenantIds = (process.env.WORKER_TENANT_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
if (tenantIds.length === 0) throw new Error("WORKER_TENANT_IDS is required");
if (tenantIds.some((id) => !uuidPattern.test(id))) throw new Error("Invalid WORKER_TENANT_IDS");

const { pool, withTenant } = await import("@memtavi/db/client");

const worker = createWorker({
  withTenant,
  tenantIds,
  concurrency,
  pollIntervalMs,
  log: (event) => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  },
});

process.once("SIGTERM", () => {
  void worker.stop();
});
process.once("SIGINT", () => {
  void worker.stop();
});

await worker.start();
await pool.end();
