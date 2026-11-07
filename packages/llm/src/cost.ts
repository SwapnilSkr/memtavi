export interface ChatPrices {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface EmbeddingPrices {
  inputPerMillionUsd: number;
}

export const DEFAULT_CHAT_PRICES: ChatPrices = {
  inputPerMillionUsd: 8,
  outputPerMillionUsd: 0.5,
};

// OpenAI text-embedding-3-small list price, USD per million input tokens.
export const DEFAULT_EMBEDDING_PRICES: EmbeddingPrices = {
  inputPerMillionUsd: 0.02,
};

const TOKENS_PER_PRICE_UNIT = 1_000_000;

export function chatCostUsd(
  inputTokens: number,
  outputTokens: number,
  prices: ChatPrices = DEFAULT_CHAT_PRICES,
): number {
  return (
    (inputTokens * prices.inputPerMillionUsd + outputTokens * prices.outputPerMillionUsd) /
    TOKENS_PER_PRICE_UNIT
  );
}

export function embeddingCostUsd(
  tokens: number,
  prices: EmbeddingPrices = DEFAULT_EMBEDDING_PRICES,
): number {
  return (tokens * prices.inputPerMillionUsd) / TOKENS_PER_PRICE_UNIT;
}
