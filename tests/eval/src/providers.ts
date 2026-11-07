import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResult,
} from "../../../packages/llm/src/provider";
import { estimateTokens } from "./tokens";

interface Chunk {
  chunkUuid: string;
  text: string;
}

interface Fact {
  claim: string;
  evidence?: { chunkUuid: string; charStart: number; charEnd: number; quote: string };
}

interface ExtractionBody {
  chunks?: Chunk[];
}

interface PatchBody {
  existing?: { title: string; summary: string; body: string };
  facts?: Fact[];
}

function messageTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message.content), 0);
}

function result(request: ChatRequest, text: string): ChatResult {
  return {
    text,
    model: request.model,
    usage: {
      inputTokens: messageTokens(request.messages),
      outputTokens: estimateTokens(text),
    },
  };
}

function extraction(body: ExtractionBody): string {
  const facts = (body.chunks ?? []).map((chunk) => ({
    claim: chunk.text,
    kind: "project_fact",
    entities: [],
    confidence: 0.9,
    durability: 0.9,
    impact: 0.9,
    recurrence: 0.9,
    novelty: 0.9,
    futureUse: 0.9,
    sensitivity: "none",
    evidence: {
      chunkUuid: chunk.chunkUuid,
      charStart: 0,
      charEnd: chunk.text.length,
      quote: chunk.text,
    },
  }));
  return JSON.stringify({ facts });
}

function patch(body: PatchBody): string {
  const existing = body.existing;
  if (!existing) throw new Error("Deterministic eval chat received a patch without a page");
  const claims = (body.facts ?? []).map((fact) => fact.claim);
  const summary = [existing.summary, ...claims].filter((part) => part.length > 0).join("\n");
  const pageBody = [existing.body, ...claims].filter((part) => part.length > 0).join("\n\n");
  return JSON.stringify({
    title: existing.title,
    summary,
    body: pageBody,
    changed: claims.length > 0,
    contradictions: [],
  });
}

export function createDeterministicChat(): ChatProvider {
  return {
    async chat(request: ChatRequest): Promise<ChatResult> {
      const user = request.messages.find((message) => message.role === "user");
      if (!user) throw new Error("Deterministic eval chat requires a user message");
      let body: unknown;
      try {
        body = JSON.parse(user.content);
      } catch {
        throw new Error("Deterministic eval chat requires a JSON user message");
      }
      if (typeof body !== "object" || body === null) {
        throw new Error("Deterministic eval chat received a non-object payload");
      }
      if (Array.isArray((body as ExtractionBody).chunks)) {
        return result(request, extraction(body as ExtractionBody));
      }
      if ((body as PatchBody).existing !== undefined) {
        return result(request, patch(body as PatchBody));
      }
      throw new Error("Deterministic eval chat cannot answer this request");
    },
  };
}
