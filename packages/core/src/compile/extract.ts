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
  const facts = result.data.facts.flatMap<ExtractedFact>((fact) => {
    const { evidence } = fact;
    if (evidence === undefined) return [];
    const text = texts.get(evidence.chunkUuid);
    if (text === undefined) return [];
    if (
      evidence.charEnd > evidence.charStart &&
      evidence.charEnd <= text.length &&
      text.slice(evidence.charStart, evidence.charEnd) === evidence.quote
    ) {
      return [{ ...fact, evidence }];
    }
    let charStart = text.indexOf(evidence.quote);
    if (charStart === -1) return [];
    for (
      let occurrence = text.indexOf(evidence.quote, charStart + 1);
      occurrence !== -1;
      occurrence = text.indexOf(evidence.quote, occurrence + 1)
    ) {
      if (Math.abs(occurrence - evidence.charStart) < Math.abs(charStart - evidence.charStart)) {
        charStart = occurrence;
      }
    }
    return [
      { ...fact, evidence: { ...evidence, charStart, charEnd: charStart + evidence.quote.length } },
    ];
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
