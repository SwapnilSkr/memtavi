import type { withTenant } from "@memtavi/db/client";
import type { EmbeddingProvider } from "@memtavi/llm/provider";
import type { Logger } from "@memtavi/shared/logging";
import type { ObjectStore } from "@memtavi/storage/types";
import type { Pool } from "pg";
import type { RateLimiter } from "./rate-limit";

export interface AppConfig {
  ownerPool: Pool;
  withTenant: typeof withTenant;
  store: ObjectStore;
  now?: () => Date;
  embeddings?: EmbeddingProvider;
  webhookSecretKey?: string;
  rateLimitPerMinute?: number;
  logger?: Logger;
}

export type RouteConfig = AppConfig & { rateLimiter: RateLimiter };
