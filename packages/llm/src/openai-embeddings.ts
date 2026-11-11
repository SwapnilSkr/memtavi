import { withSpan } from "@memtavi/shared/telemetry";
import {
  DEFAULT_TIMEOUT_MS,
  type FetchImpl,
  isRecord,
  isTokenCount,
  malformedResponse,
  postJson,
  trimmedBaseUrl,
} from "./http";
import { type EmbeddingProvider, type EmbeddingResult, ProviderError } from "./provider";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const MAX_EMBEDDING_BATCH = 64;

export interface OpenAIEmbeddingsOptions {
  apiKey: string;
  model: string;
  dimensions: number;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

interface ParsedBatch {
  vectors: number[][];
  model: string;
  inputTokens: number;
}

function parseBatch(
  payload: unknown,
  expected: number,
  dimensions: number,
  configuredModel: string,
): ParsedBatch {
  if (!isRecord(payload)) throw malformedResponse();

  const data = payload.data;
  if (!Array.isArray(data) || data.length !== expected) throw malformedResponse();

  const usage = payload.usage;
  if (!isRecord(usage) || !isTokenCount(usage.prompt_tokens)) throw malformedResponse();

  const ordered = new Array<number[] | undefined>(expected);
  for (const item of data) {
    if (!isRecord(item)) throw malformedResponse();
    const index = item.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= expected) {
      throw malformedResponse();
    }
    if (ordered[index] !== undefined) throw malformedResponse();
    const embedding = item.embedding;
    if (!Array.isArray(embedding)) throw malformedResponse();
    if (embedding.length !== dimensions) {
      throw new ProviderError(
        "dimension_mismatch",
        false,
        "Provider returned the wrong embedding dimensions",
      );
    }
    ordered[index] = embedding.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) throw malformedResponse();
      return value;
    });
  }

  const vectors = ordered.map((vector) => {
    if (vector === undefined) throw malformedResponse();
    return vector;
  });

  const reported = payload.model;
  const model = typeof reported === "string" && reported.length > 0 ? reported : configuredModel;

  return { vectors, model, inputTokens: usage.prompt_tokens };
}

export function createOpenAIImbeddings(options: OpenAIEmbeddingsOptions): EmbeddingProvider {
  if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
    throw new RangeError("dimensions must be a positive integer");
  }

  const baseUrl = trimmedBaseUrl(options.baseUrl ?? OPENAI_DEFAULT_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async embed(texts: readonly string[]): Promise<EmbeddingResult> {
      const vectors: number[][] = [];
      let inputTokens = 0;
      let model = options.model;

      for (let start = 0; start < texts.length; start += MAX_EMBEDDING_BATCH) {
        const batch = texts.slice(start, start + MAX_EMBEDDING_BATCH);
        const parsed = await withSpan(
          "provider.embeddings",
          { provider: "openai", model: options.model },
          async (span) => {
            try {
              const { payload, status } = await postJson(`${baseUrl}/embeddings`, {
                apiKey: options.apiKey,
                body: {
                  model: options.model,
                  input: batch,
                  dimensions: options.dimensions,
                },
                fetchImpl,
                timeoutMs,
              });
              const result = parseBatch(payload, batch.length, options.dimensions, options.model);
              span.setAttributes({
                model: result.model,
                input_tokens: result.inputTokens,
                status_code: status,
              });
              return result;
            } catch (error) {
              if (error instanceof ProviderError) {
                span.setAttribute("error_type", error.code);
                if (error.status !== null) span.setAttribute("status_code", error.status);
              }
              throw error;
            }
          },
        );
        vectors.push(...parsed.vectors);
        inputTokens += parsed.inputTokens;
        model = parsed.model;
      }

      return {
        vectors,
        model,
        dimensions: options.dimensions,
        usage: { inputTokens },
      };
    },
  };
}
