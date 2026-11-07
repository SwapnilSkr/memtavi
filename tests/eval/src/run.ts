import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CompilerConfig, CompilerUsage, RoutingEvent } from "../../../apps/worker/src/types";
import type { ChatPrices } from "../../../packages/llm/src/cost";
import type { ChatProvider } from "../../../packages/llm/src/provider";
import { createFakeStore } from "../../../packages/storage/src/fake";
import {
  answerFromIndex,
  answerWithChat,
  buildReadBlock,
  buildSummaryIndex,
  type IndexBudget,
  loadIndexPages,
  loadRankedPages,
} from "./answer";
import { BudgetExceededError, type EvalBudget } from "./budget";
import { judge } from "./judge";
import { type CompiledConversation, EvalPipeline } from "./pipeline";
import { aggregateRouting } from "./routing";
import type {
  Aggregates,
  ConversationSummary,
  Dataset,
  EvalResults,
  Question,
  QuestionResult,
} from "./types";

export interface RunConfig {
  mode: "fake" | "live";
  dataset: Dataset;
  datasetPath: string;
  indexTokens: number;
  readTokens: number;
  ownerUrl: string;
  appUrl: string;
  compiler: CompilerConfig;
  answerProvider: ChatProvider | null;
  chatModel: string;
  chatPrices: ChatPrices;
  budget: EvalBudget | null;
}

export interface RunOutput {
  results: EvalResults;
  path: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted[middle] ?? 0;
}

function summarise(
  results: readonly QuestionResult[],
  questionCount: number,
  totalCostUsd: number,
): Aggregates {
  const answered = results.length;
  const exact = results.filter((result) => result.exactMatch).length;
  const accuracy = answered > 0 ? exact / answered : 0;
  const meanF1 =
    answered > 0 ? results.reduce((total, result) => total + result.f1, 0) / answered : 0;
  const meanInjectedTokens =
    answered > 0
      ? results.reduce((total, result) => total + result.injectedTokens, 0) / answered
      : 0;
  return {
    questions: questionCount,
    answered,
    accuracy: round(accuracy, 6),
    meanF1: round(meanF1, 6),
    meanInjectedTokens: round(meanInjectedTokens, 2),
    accuracyPer1kTokens:
      meanInjectedTokens > 0 ? round((accuracy * 1000) / meanInjectedTokens, 6) : 0,
    p50LatencyMs: round(median(results.map((result) => result.latencyMs)), 2),
    totalCostUsd: round(totalCostUsd, 8),
  };
}

async function writeResults(results: EvalResults): Promise<string> {
  const directory = fileURLToPath(new URL("../results/", import.meta.url));
  const stamp = results.finishedAt.replace(/[:.]/g, "-");
  const path = `${directory}${stamp}.json`;
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  return path;
}

async function answerQuestion(
  config: RunConfig,
  pipeline: EvalPipeline,
  brainId: string,
  index: IndexBudget,
  question: Question,
): Promise<QuestionResult> {
  const started = performance.now();
  const ranked = await pipeline.withScope((client) =>
    loadRankedPages(client, pipeline.tenantId, brainId, question.question),
  );
  const read = buildReadBlock(ranked, config.readTokens);
  const answer =
    config.mode === "live" && config.answerProvider
      ? await answerWithChat(
          config.answerProvider,
          config.chatModel,
          {
            question: question.question,
            summaryIndex: index.text,
            readBlock: read.text,
          },
          config.chatPrices,
        )
      : answerFromIndex(index.text, read.text, question.question);
  const latencyMs = performance.now() - started;
  const verdict = judge(answer.answer, question.answer);
  return {
    questionId: question.id,
    conversationId: question.conversationId,
    category: question.category,
    question: question.question,
    gold: question.answer,
    prediction: answer.answer,
    exactMatch: verdict.exact,
    f1: round(verdict.f1, 6),
    injectedTokens: answer.injectedTokens,
    providerInputTokens: answer.providerInputTokens,
    latencyMs: round(latencyMs, 2),
    costUsd: round(answer.costUsd, 8),
  };
}

export async function runEval(config: RunConfig): Promise<RunOutput> {
  const usage: CompilerUsage[] = [];
  const errors: string[] = [];
  const collected: QuestionResult[] = [];
  const conversations: ConversationSummary[] = [];
  const routingEvents: RoutingEvent[] = [];
  let stoppedReason: string | null = null;
  const startedAt = new Date();

  const pipeline = await EvalPipeline.open({
    ownerUrl: config.ownerUrl,
    appUrl: config.appUrl,
    store: createFakeStore(),
    compiler: config.compiler,
    onUsage: (entry) => {
      usage.push(entry);
    },
  });

  try {
    for (const [ordinal, conversation] of config.dataset.conversations.entries()) {
      if (stoppedReason) break;

      let compiled: CompiledConversation;
      try {
        compiled = await pipeline.compileConversation(conversation, ordinal);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          stoppedReason = error.message;
          break;
        }
        errors.push(`conversation ${conversation.id}: ${messageOf(error)}`);
        continue;
      }

      conversations.push({
        conversationId: compiled.conversationId,
        brainId: compiled.brainId,
        counts: compiled.counts,
      });
      routingEvents.push(...compiled.routing);
      for (const failure of compiled.failures) {
        errors.push(`source ${failure.sourceId}: ${failure.message}`);
      }

      let index: IndexBudget;
      try {
        const pages = await pipeline.withScope((client) =>
          loadIndexPages(client, pipeline.tenantId, compiled.brainId),
        );
        index = buildSummaryIndex(pages, config.indexTokens);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          stoppedReason = error.message;
          break;
        }
        errors.push(`index ${conversation.id}: ${messageOf(error)}`);
        continue;
      }

      for (const question of config.dataset.questions) {
        if (stoppedReason) break;
        if (question.conversationId !== conversation.id) continue;
        try {
          collected.push(await answerQuestion(config, pipeline, compiled.brainId, index, question));
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            stoppedReason = error.message;
            break;
          }
          errors.push(`question ${question.id}: ${messageOf(error)}`);
        }
      }
    }

    const finishedAt = new Date();
    const compileCost = usage.reduce((total, entry) => total + entry.costUsd, 0);
    const answerCost = collected.reduce((total, result) => total + result.costUsd, 0);
    const spentUsd = config.budget ? config.budget.spentUsd : compileCost + answerCost;
    const results: EvalResults = {
      mode: config.mode,
      label: config.mode === "fake" ? "plumbing check, not accuracy" : "measured",
      dataset: config.dataset.name,
      datasetPath: config.datasetPath,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      budgetUsd: config.budget ? config.budget.limitUsd : null,
      spentUsd: round(spentUsd, 8),
      stoppedReason,
      aggregates: summarise(collected, config.dataset.questions.length, spentUsd),
      routing: aggregateRouting(routingEvents),
      conversations,
      results: collected,
      errors,
    };
    const path = await writeResults(results);
    return { results, path };
  } finally {
    try {
      await pipeline.cleanup();
    } finally {
      await pipeline.close();
    }
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width);
}

export function printResults(output: RunOutput): void {
  const { results, path } = output;
  const label = results.mode === "fake" ? "PLUMBING CHECK, NOT ACCURACY" : "measured";
  console.log(`mode:      ${results.mode} (${label})`);
  console.log(`dataset:   ${results.dataset} (${results.datasetPath})`);
  console.log(`budget:    ${results.budgetUsd === null ? "-" : `$${results.budgetUsd}`}`);
  if (results.stoppedReason) console.log(`stopped:   ${results.stoppedReason}`);
  console.log("");
  console.log(
    `${pad("question", 26)}${pad("category", 14)}${pad("exact", 8)}${pad("f1", 8)}${pad("tokens", 8)}latency`,
  );
  for (const result of results.results) {
    console.log(
      `${pad(result.questionId, 26)}${pad(result.category, 14)}${pad(
        result.exactMatch ? "yes" : "no",
        8,
      )}${pad(result.f1.toFixed(3), 8)}${pad(String(result.injectedTokens), 8)}${result.latencyMs.toFixed(1)}ms`,
    );
  }
  console.log("");
  console.log(
    `${pad("conversation", 26)}${pad("completed", 12)}${pad("failed", 8)}${pad("pages", 8)}${pad("versions", 10)}reviews`,
  );
  for (const entry of results.conversations) {
    const { counts } = entry;
    console.log(
      `${pad(entry.conversationId, 26)}${pad(String(counts.sourcesCompleted), 12)}${pad(
        String(counts.sourcesFailed),
        8,
      )}${pad(String(counts.pages), 8)}${pad(String(counts.pageVersions), 10)}${counts.routingReviews}`,
    );
  }
  console.log("");
  const plumbing = results.mode === "fake" ? "  (plumbing only, not accuracy)" : "";
  console.log(`accuracy:               ${results.aggregates.accuracy.toFixed(3)}${plumbing}`);
  console.log(`mean F1:                ${results.aggregates.meanF1.toFixed(3)}`);
  console.log(`mean injected tokens:   ${results.aggregates.meanInjectedTokens.toFixed(1)}`);
  console.log(`accuracy per 1k tokens: ${results.aggregates.accuracyPer1kTokens.toFixed(3)}`);
  console.log(`p50 latency:            ${results.aggregates.p50LatencyMs.toFixed(1)}ms`);
  const costLabel = results.mode === "fake" ? "estimated fake cost" : "total cost";
  console.log(`${costLabel}: $${results.aggregates.totalCostUsd.toFixed(6)}`);
  console.log(
    `answered:               ${results.aggregates.answered}/${results.aggregates.questions}`,
  );
  for (const error of results.errors) console.log(`error: ${error}`);
  console.log("");
  const { routing } = results;
  console.log(`routing: ${routing.total} facts decided`);
  console.log(
    `  actions:               place ${routing.actions.place}, review ${routing.actions.review}, new ${routing.actions.new}`,
  );
  console.log(
    `  reasons:               score ${routing.reasons.score}, entity ${routing.reasons.entity}, new ${routing.reasons.new}, split ${routing.reasons.split}`,
  );
  console.log(
    `  best score:            mean ${routing.best.mean.toFixed(3)}, median ${routing.best.median.toFixed(3)}`,
  );
  console.log(`  mean candidates:       ${routing.meanCandidateCount.toFixed(2)}`);
  console.log(`  best buckets:`);
  for (const bucket of routing.bestBuckets) {
    console.log(`    ${pad(bucket.bucket, 12)}${bucket.count}`);
  }
  console.log(`  gap buckets (best >= 0.45):`);
  for (const bucket of routing.gapBuckets) {
    console.log(`    ${pad(bucket.bucket, 12)}${bucket.count}`);
  }
  console.log(`  top reviews:`);
  for (const review of routing.topReviews) {
    console.log(
      `    best ${review.best.toFixed(3)}  second ${review.second.toFixed(3)}  gap ${review.gap.toFixed(
        3,
      )}  candidates ${review.candidateCount}  ${review.claim}`,
    );
  }
  console.log("");
  console.log(`results: ${path}`);
}
