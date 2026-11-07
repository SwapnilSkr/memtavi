import { type ChatPrices, chatCostUsd } from "@memtavi/llm/cost";
import type { ChatMessage, ChatProvider, ChatResult } from "@memtavi/llm/provider";
import { CompileError } from "./errors";
import { prompts, promptVersion } from "./prompts";
import { type ExtractedFact, extractionResultSchema } from "./schemas";

export { CompileError } from "./errors";

export interface Chunk {
  chunkUuid: string;
  text: string;
}

export interface ExtractConfig {
  model: string;
  promptVersion: string;
  prices?: ChatPrices;
}

export function buildExtractionMessages(chunks: readonly Chunk[], version: string): ChatMessage[] {
  if (version !== promptVersion("extract")) throw new CompileError();
  const ordered = [...chunks].sort(
    (a, b) =>
      (a.chunkUuid < b.chunkUuid ? -1 : a.chunkUuid > b.chunkUuid ? 1 : 0) ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
  if (new Set(ordered.map((chunk) => chunk.chunkUuid)).size !== ordered.length) {
    throw new CompileError();
  }
  return [
    { role: "system", content: prompts.extract },
    { role: "user", content: JSON.stringify({ promptVersion: version, chunks: ordered }) },
  ];
}

export async function extractFacts(
  provider: ChatProvider,
  chunks: readonly Chunk[],
  config: ExtractConfig,
) {
  const response: ChatResult = await provider.chat({
    model: config.model,
    messages: buildExtractionMessages(chunks, config.promptVersion),
    temperature: 0,
    responseFormat: "json",
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new CompileError();
  }
  const result = extractionResultSchema.safeParse(parsed);
  if (!result.success) throw new CompileError();
  const texts = new Map(chunks.map((chunk) => [chunk.chunkUuid, chunk.text]));
  const facts = result.data.facts.filter((fact): fact is ExtractedFact => {
    const { evidence } = fact;
    if (evidence === undefined) return false;
    const text = texts.get(evidence.chunkUuid);
    return (
      text !== undefined &&
      evidence.charEnd > evidence.charStart &&
      evidence.charEnd <= text.length &&
      text.slice(evidence.charStart, evidence.charEnd) === evidence.quote
    );
  });
  return {
    facts,
    promptVersion: config.promptVersion,
    model: response.model,
    usage: response.usage,
    costUsd: chatCostUsd(response.usage.inputTokens, response.usage.outputTokens, config.prices),
    droppedFacts: result.data.facts.length - facts.length,
  };
}
