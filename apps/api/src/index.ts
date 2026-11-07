import { Pool } from "pg";
import { createApp } from "./app";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL are required");
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const { buildStoreFromEnv } = await import("@memtavi/storage/config");
const { pool, withTenant } = await import("@memtavi/db/client");
const ownerPool = new Pool({ connectionString: databaseUrl });
const store = await buildStoreFromEnv(process.env);
const app = createApp({ ownerPool, withTenant, store }).listen(port);

async function shutdown() {
  await app.stop();
  await Promise.all([ownerPool.end(), pool.end()]);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
