import { createHash } from "node:crypto";
import {
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
  type EmbeddingProvider,
  type EmbeddingResult,
  ProviderError,
} from "./provider";

export const FAKE_DEFAULT_DIMENSIONS = 1536;
export const FAKE_DEFAULT_EMBEDDING_MODEL = "fake-embedding";

export interface FakeChatCall {
  kind: "chat";
  request: ChatRequest;
}

export interface FakeEmbeddingCall {
  kind: "embed";
  texts: string[];
}

export type FakeCall = FakeChatCall | FakeEmbeddingCall;

export type FakeChatOutcome = string | ChatResult | ProviderError;

export type FakeEmbedOutcome = "ok" | ProviderError;

export interface FakeProviderOptions {
  dimensions?: number;
  embeddingModel?: string;
  chatResponses?: FakeChatOutcome[];
}

export interface FakeProvider extends ChatProvider, EmbeddingProvider {
  readonly calls: readonly FakeCall[];
  queueChat(...outcomes: FakeChatOutcome[]): void;
  queueEmbed(...outcomes: FakeEmbedOutcome[]): void;
  reset(): void;
}

function digestFor(text: string, block: number): Buffer {
  return createHash("sha256").update(`${text}\u0000${block}`).digest();
}

function vectorFor(text: string, dimensions: number): number[] {
  if (dimensions <= 0) return [];

  const values = new Array<number>(dimensions);
  let block = 0;
  let digest = digestFor(text, block);
  let cursor = 0;

  for (let index = 0; index < dimensions; index += 1) {
    if (cursor + 4 > digest.length) {
      block += 1;
      digest = digestFor(text, block);
      cursor = 0;
    }
    const raw = digest.readUInt32BE(cursor);
    cursor += 4;
    values[index] = (raw / 0xffffffff) * 2 - 1;
  }

  const sum = values.reduce((total, value) => total + value * value, 0);
  const norm = Math.sqrt(sum);
  if (norm === 0) {
    values.fill(0);
    values[0] = 1;
    return values;
  }
  return values.map((value) => value / norm);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const dimensions = options.dimensions ?? FAKE_DEFAULT_DIMENSIONS;
  const embeddingModel = options.embeddingModel ?? FAKE_DEFAULT_EMBEDDING_MODEL;
  const calls: FakeCall[] = [];
  const queue: FakeChatOutcome[] = [...(options.chatResponses ?? [])];
  const embedQueue: FakeEmbedOutcome[] = [];

  return {
    calls,

    queueChat(...outcomes: FakeChatOutcome[]): void {
      queue.push(...outcomes);
    },

    queueEmbed(...outcomes: FakeEmbedOutcome[]): void {
      embedQueue.push(...outcomes);
    },

    reset(): void {
      calls.length = 0;
      queue.length = 0;
      embedQueue.length = 0;
    },

    async chat(request: ChatRequest): Promise<ChatResult> {
      calls.push({ kind: "chat", request });
      const next = queue.shift();
      if (next === undefined) {
        throw new ProviderError(
          "fake_exhausted",
          false,
          "Fake provider has no queued chat response",
        );
      }
      if (next instanceof ProviderError) throw next;
      if (typeof next === "string") {
        return {
          text: next,
          model: request.model,
          usage: {
            inputTokens: request.messages.reduce(
              (total, message) => total + estimateTokens(message.content),
              0,
            ),
            outputTokens: estimateTokens(next),
          },
        };
      }
      return next;
    },

    async embed(texts: readonly string[]): Promise<EmbeddingResult> {
      const recorded = [...texts];
      calls.push({ kind: "embed", texts: recorded });
      const next = embedQueue.shift();
      if (next instanceof ProviderError) throw next;
      return {
        vectors: recorded.map((text) => vectorFor(text, dimensions)),
        model: embeddingModel,
        dimensions,
        usage: {
          inputTokens: recorded.reduce((total, text) => total + estimateTokens(text), 0),
        },
      };
    },
  };
}
