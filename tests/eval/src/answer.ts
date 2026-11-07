import { type ChatPrices, chatCostUsd, DEFAULT_CHAT_PRICES } from "../../../packages/llm/src/cost";
import type { ChatProvider } from "../../../packages/llm/src/provider";
import type { Queryable } from "./db";
import { estimateTokens } from "./tokens";

export const DEFAULT_INDEX_TOKENS = 1500;
export const DEFAULT_READ_TOKENS = 2000;
export const TOP_PAGES = 3;

export const ANSWER_SYSTEM =
  "Answer the question using only the memory context. Reply with the shortest exact answer and no explanation.";

export interface IndexPage {
  id: string;
  slug: string;
  title: string;
  summary: string;
}

export interface ReadPage {
  id: string;
  title: string;
  body: string;
}

export interface IndexBudget {
  text: string;
  used: number;
  included: number;
  skipped: number;
}

export interface AnswerInput {
  question: string;
  summaryIndex: string;
  readBlock: string;
}

export interface AnswerOutput {
  answer: string;
  injectedTokens: number;
  providerInputTokens: number | null;
  costUsd: number;
}

export function buildSummaryIndex(pages: readonly IndexPage[], maxTokens: number): IndexBudget {
  const lines: string[] = [];
  let used = 0;
  let included = 0;
  let skipped = 0;
  for (const page of pages) {
    const line = `- ${page.summary.length > 0 ? page.summary : page.title}`;
    const cost = estimateTokens(line) + 1;
    if (used + cost > maxTokens) {
      skipped += 1;
      continue;
    }
    lines.push(line);
    used += cost;
    included += 1;
  }
  return { text: lines.join("\n"), used, included, skipped };
}

export function buildReadBlock(pages: readonly ReadPage[], maxTokens: number): IndexBudget {
  const blocks: string[] = [];
  let used = 0;
  let included = 0;
  let skipped = 0;
  for (const page of pages) {
    const block = `### ${page.title}\n${page.body}`;
    const cost = estimateTokens(block) + 1;
    if (used + cost > maxTokens) {
      skipped += 1;
      continue;
    }
    blocks.push(block);
    used += cost;
    included += 1;
  }
  return { text: blocks.join("\n\n"), used, included, skipped };
}

export async function loadIndexPages(
  client: Queryable,
  tenantId: string,
  brainId: string,
): Promise<IndexPage[]> {
  const result = await client.query<IndexPage>(
    `SELECT id, slug, title, summary FROM pages
     WHERE tenant_id = $1 AND brain_id = $2 AND deletion_state = 'active'
       AND status IN ('active', 'contested')
     ORDER BY slug, id`,
    [tenantId, brainId],
  );
  return result.rows;
}

export async function loadRankedPages(
  client: Queryable,
  tenantId: string,
  brainId: string,
  question: string,
  limit = TOP_PAGES,
): Promise<ReadPage[]> {
  const result = await client.query<ReadPage>(
    `SELECT p.id, p.title, p.body FROM pages p
     WHERE p.tenant_id = $1 AND p.brain_id = $2 AND p.deletion_state = 'active'
       AND p.status IN ('active', 'contested')
       AND p.search_tsv @@ websearch_to_tsquery('english', $3)
     ORDER BY ts_rank(p.search_tsv, websearch_to_tsquery('english', $3)) DESC, p.slug, p.id
     LIMIT $4`,
    [tenantId, brainId, question, limit],
  );
  return result.rows;
}

export function assembleAnswerPrompt(input: AnswerInput): string {
  return [
    "## Memory index (summaries)",
    input.summaryIndex.length > 0 ? input.summaryIndex : "(empty)",
    "",
    "## Retrieved pages",
    input.readBlock.length > 0 ? input.readBlock : "(none)",
    "",
    "## Question",
    input.question,
  ].join("\n");
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "in",
  "is",
  "it",
  "its",
  "name",
  "named",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "with",
]);

const SOURCE_LINE = /^-\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+-\d+\s/i;
const SPEAKER_PREFIX = /^[A-Z][\p{L}.'\u2019-]{0,30}:\s*/u;

function scoringTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => !STOPWORDS.has(token),
  );
}

function stripSpeaker(sentence: string): string {
  return sentence.replace(SPEAKER_PREFIX, "").trim();
}

export function ruleBasedAnswer(context: string, question: string): string {
  const wanted = new Set(scoringTokens(question));
  if (wanted.size === 0) return "";

  const candidates: { text: string; tokens: string[] }[] = [];
  for (const rawLine of context.split(/\n+/)) {
    const line = rawLine.replace(/^[-*]\s+/, "").trim();
    if (line.length === 0 || line.startsWith("#") || SOURCE_LINE.test(rawLine.trim())) continue;
    for (const rawSentence of line.split(/(?<=[.!?])\s+/)) {
      const sentence = stripSpeaker(rawSentence.trim());
      if (sentence.length > 0) candidates.push({ text: sentence, tokens: scoringTokens(sentence) });
    }
  }

  const documentFrequency = new Map<string, number>();
  for (const candidate of candidates) {
    for (const token of new Set(candidate.tokens)) {
      if (wanted.has(token)) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    let score = 0;
    for (const token of new Set(candidate.tokens)) {
      if (!wanted.has(token)) continue;
      const frequency = documentFrequency.get(token) ?? 1;
      score += Math.log((candidates.length + 1) / (frequency + 1)) + 1;
    }
    if (
      score > bestScore ||
      (score === bestScore && score > 0 && candidate.text.length < best.length)
    ) {
      best = candidate.text;
      bestScore = score;
    }
  }
  return best;
}

export async function answerWithChat(
  provider: ChatProvider,
  model: string,
  input: AnswerInput,
  prices: ChatPrices = DEFAULT_CHAT_PRICES,
): Promise<AnswerOutput> {
  const user = assembleAnswerPrompt(input);
  const response = await provider.chat({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: ANSWER_SYSTEM },
      { role: "user", content: user },
    ],
  });
  return {
    answer: response.text.trim(),
    injectedTokens: estimateTokens(ANSWER_SYSTEM) + estimateTokens(user),
    providerInputTokens: response.usage.inputTokens,
    costUsd: chatCostUsd(response.usage.inputTokens, response.usage.outputTokens, prices),
  };
}

export function answerFromIndex(
  summaryIndex: string,
  readBlock: string,
  question: string,
): AnswerOutput {
  const input = { question, summaryIndex, readBlock };
  return {
    answer: ruleBasedAnswer(`${summaryIndex}\n${readBlock}`, question),
    injectedTokens: estimateTokens(ANSWER_SYSTEM) + estimateTokens(assembleAnswerPrompt(input)),
    providerInputTokens: null,
    costUsd: 0,
  };
}
