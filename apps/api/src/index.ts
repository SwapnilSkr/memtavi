import { createOpenAIImbeddings } from "@memtavi/llm/openai-embeddings";
import { Pool } from "pg";
import { createApp } from "./app";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL are required");
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300);
if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1) {
  throw new Error("Invalid RATE_LIMIT_PER_MINUTE");
}
const { buildStoreFromEnv } = await import("@memtavi/storage/config");
const { pool, withTenant } = await import("@memtavi/db/client");
const ownerPool = new Pool({ connectionString: databaseUrl });
const store = await buildStoreFromEnv(process.env);
const embeddingKey = process.env.OPENAI_API_KEY;
const embeddingModel = process.env.EMBEDDING_MODEL;
const embeddings =
  embeddingKey?.trim() && embeddingModel?.trim()
    ? createOpenAIImbeddings({ apiKey: embeddingKey, model: embeddingModel, dimensions: 1536 })
    : undefined;
const app = createApp({
  ownerPool,
  withTenant,
  store,
  rateLimitPerMinute,
  ...(embeddings === undefined ? {} : { embeddings }),
  ...(process.env.WEBHOOK_SECRET_KEY === undefined
    ? {}
    : { webhookSecretKey: process.env.WEBHOOK_SECRET_KEY }),
}).listen(port);

async function shutdown() {
  await app.stop();
  await Promise.all([ownerPool.end(), pool.end()]);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
