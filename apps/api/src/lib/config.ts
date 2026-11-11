import type { withTenant } from "@memtavi/db/client";
import { type ChatPrices, DEFAULT_CHAT_PRICES } from "@memtavi/llm/cost";
import { createOpenRouterChat } from "@memtavi/llm/openrouter";
import type { ChatProvider, EmbeddingProvider } from "@memtavi/llm/provider";
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
  profileSuggestions?: { provider: ChatProvider; model: string; prices?: ChatPrices };
  budgetEmergencyStop?: () => boolean;
  webhookSecretKey?: string;
  rateLimitPerMinute?: number;
  logger?: Logger;
}

export type RouteConfig = AppConfig & { rateLimiter: RateLimiter };

export function profileSuggestionsFromEnv(): AppConfig["profileSuggestions"] {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey?.trim()) return undefined;
  const model = process.env.OPENROUTER_CHAT_MODEL?.trim();
  if (!model || /latest/i.test(model))
    throw new Error("A pinned OPENROUTER_CHAT_MODEL is required");
  const rates = [process.env.OPENROUTER_INPUT_USD_PER_M, process.env.OPENROUTER_OUTPUT_USD_PER_M];
  const inputPerMillionUsd = Number(rates[0] || DEFAULT_CHAT_PRICES.inputPerMillionUsd);
  const outputPerMillionUsd = Number(rates[1] || DEFAULT_CHAT_PRICES.outputPerMillionUsd);
  if (
    ![inputPerMillionUsd, outputPerMillionUsd].every((rate) => Number.isFinite(rate) && rate > 0)
  ) {
    throw new Error("Invalid profile suggestion model prices");
  }
  return {
    provider: createOpenRouterChat({ apiKey }),
    model,
    prices: { inputPerMillionUsd, outputPerMillionUsd },
  };
}
