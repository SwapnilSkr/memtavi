export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ResponseFormat = "json";

export interface ChatRequest {
  model: string;
  messages: readonly ChatMessage[];
  temperature?: number;
  responseFormat?: ResponseFormat;
}

export interface ChatResult {
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimensions: number;
  usage: {
    inputTokens: number;
  };
}

export interface ChatProvider {
  chat(request: ChatRequest): Promise<ChatResult>;
}

export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<EmbeddingResult>;
}

export type ProviderErrorCode =
  | "rate_limited"
  | "server_error"
  | "bad_request"
  | "timeout"
  | "network"
  | "malformed_response"
  | "dimension_mismatch"
  | "fake_exhausted";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly transient: boolean;
  readonly status: number | null;

  constructor(code: ProviderErrorCode, transient: boolean, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.transient = transient;
    this.status = status ?? null;
  }
}
