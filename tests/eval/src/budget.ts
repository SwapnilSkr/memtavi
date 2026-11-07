import {
  type ChatPrices,
  chatCostUsd,
  DEFAULT_CHAT_PRICES,
  DEFAULT_EMBEDDING_PRICES,
  type EmbeddingPrices,
  embeddingCostUsd,
} from "../../../packages/llm/src/cost";
import type {
  ChatProvider,
  ChatRequest,
  EmbeddingProvider,
  EmbeddingResult,
} from "../../../packages/llm/src/provider";
import { estimateTokens } from "./tokens";

export const OUTPUT_TOKEN_ESTIMATE = 1024;

export class BudgetExceededError extends Error {
  constructor(
    readonly limitUsd: number,
    readonly spentUsd: number,
    message: string,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class EvalBudget {
  spentUsd = 0;
  calls = 0;

  constructor(
    readonly limitUsd: number,
    readonly chatPrices: ChatPrices = DEFAULT_CHAT_PRICES,
    readonly embeddingPrices: EmbeddingPrices = DEFAULT_EMBEDDING_PRICES,
  ) {}

  get remainingUsd(): number {
    return Math.max(0, this.limitUsd - this.spentUsd);
  }

  ensure(projectedUsd: number): void {
    if (this.spentUsd + projectedUsd > this.limitUsd) {
      throw new BudgetExceededError(
        this.limitUsd,
        this.spentUsd,
        `Eval budget would be exceeded: $${this.spentUsd.toFixed(6)} spent, $${projectedUsd.toFixed(6)} projected, $${this.limitUsd.toFixed(6)} cap`,
      );
    }
  }

  record(costUsd: number): void {
    this.spentUsd += costUsd;
    this.calls += 1;
  }
}

function requestTokens(request: ChatRequest): number {
  return request.messages.reduce((total, message) => total + estimateTokens(message.content), 0);
}

export function guardChat(provider: ChatProvider, budget: EvalBudget): ChatProvider {
  return {
    async chat(request: ChatRequest) {
      budget.ensure(chatCostUsd(requestTokens(request), OUTPUT_TOKEN_ESTIMATE, budget.chatPrices));
      const response = await provider.chat(request);
      budget.record(
        chatCostUsd(response.usage.inputTokens, response.usage.outputTokens, budget.chatPrices),
      );
      return response;
    },
  };
}

export function guardEmbeddings(
  provider: EmbeddingProvider,
  budget: EvalBudget,
): EmbeddingProvider {
  return {
    async embed(texts: readonly string[]): Promise<EmbeddingResult> {
      const inputTokens = texts.reduce((total, text) => total + estimateTokens(text), 0);
      budget.ensure(embeddingCostUsd(inputTokens, budget.embeddingPrices));
      const response = await provider.embed(texts);
      budget.record(embeddingCostUsd(response.usage.inputTokens, budget.embeddingPrices));
      return response;
    },
  };
}
