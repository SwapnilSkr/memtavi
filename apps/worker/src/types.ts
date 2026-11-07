import type { FetchedDocument } from "@memtavi/fetch";
import type { ChatPrices, EmbeddingPrices } from "@memtavi/llm/cost";
import type { ChatProvider, EmbeddingProvider } from "@memtavi/llm/provider";
import type { ObjectStore } from "@memtavi/storage/types";
import type { PoolClient } from "pg";

export interface ClaimedJob {
  id: string;
  tenantId: string;
  brainId: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface JobContext {
  job: ClaimedJob;
  client: PoolClient;
  store: ObjectStore;
  fetchDocument: (url: string) => Promise<FetchedDocument>;
  compiler?: CompilerConfig | undefined;
  recordUsage?: (usage: CompilerUsage) => Promise<void>;
}

export interface CompilerUsage {
  provider: string;
  model: string;
  kind: "chat" | "embedding";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CompilerConfig {
  chatProvider: ChatProvider;
  embeddingProvider: EmbeddingProvider;
  chatModel: string;
  embeddingModel: string;
  chatPrices?: ChatPrices;
  embeddingPrices?: EmbeddingPrices;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export class JobError extends Error {
  constructor(
    readonly kind: "transient" | "permanent",
    message: string,
  ) {
    super(message);
    this.name = "JobError";
  }
}
