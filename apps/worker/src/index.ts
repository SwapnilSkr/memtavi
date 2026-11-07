import { createOpenAIImbeddings } from "@memtavi/llm/openai-embeddings";
import { createOpenRouterChat } from "@memtavi/llm/openrouter";
import { createWorker } from "./worker";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!process.env.APP_DATABASE_URL) throw new Error("APP_DATABASE_URL is required");
const chatKey = process.env.OPENROUTER_API_KEY;
const embeddingKey = process.env.OPENAI_API_KEY;
const chatModel = process.env.OPENROUTER_CHAT_MODEL;
const embeddingModel = process.env.EMBEDDING_MODEL;
if (!chatKey?.trim()) throw new Error("OPENROUTER_API_KEY is required");
if (!embeddingKey?.trim()) throw new Error("OPENAI_API_KEY is required");
if (!chatModel?.trim() || /latest/i.test(chatModel)) {
  throw new Error("A pinned OPENROUTER_CHAT_MODEL is required");
}
if (!embeddingModel?.trim() || /latest/i.test(embeddingModel)) {
  throw new Error("A pinned EMBEDDING_MODEL is required");
}

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

const { buildStoreFromEnv } = await import("@memtavi/storage/config");
const { pool, withTenant } = await import("@memtavi/db/client");
const store = await buildStoreFromEnv(process.env);

const worker = createWorker({
  withTenant,
  tenantIds,
  concurrency,
  pollIntervalMs,
  store,
  compiler: {
    chatProvider: createOpenRouterChat({ apiKey: chatKey }),
    embeddingProvider: createOpenAIImbeddings({
      apiKey: embeddingKey,
      model: embeddingModel,
      dimensions: 1536,
    }),
    chatModel,
    embeddingModel,
  },
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
