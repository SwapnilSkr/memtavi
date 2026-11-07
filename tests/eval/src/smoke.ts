import { DEFAULT_CHAT_PRICES, DEFAULT_EMBEDDING_PRICES } from "../../../packages/llm/src/cost";
import { createFakeProvider } from "../../../packages/llm/src/fake";
import { createOpenAIImbeddings } from "../../../packages/llm/src/openai-embeddings";
import { createOpenRouterChat } from "../../../packages/llm/src/openrouter";
import { DEFAULT_INDEX_TOKENS, DEFAULT_READ_TOKENS } from "./answer";
import { EvalBudget, guardChat, guardEmbeddings } from "./budget";
import { loadDatasetFromEnv } from "./load";
import { createDeterministicChat } from "./providers";
import { printResults, type RunConfig, runEval } from "./run";

export type EvalMode = "fake" | "live";

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function positiveUsd(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    throw new Error("EVAL_MODE=live requires EVAL_BUDGET_USD");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("EVAL_BUDGET_USD must be a positive number");
  }
  return parsed;
}

function positiveRate(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}

function pinnedModel(value: string | undefined, name: string): string {
  const model = required(value, name);
  if (/latest/i.test(model)) throw new Error(`${name} must pin an explicit model id`);
  return model;
}

export type BuiltConfig = RunConfig;

export function buildConfig(
  env: Record<string, string | undefined>,
  dataset: RunConfig["dataset"],
  datasetPath: string,
): BuiltConfig {
  const mode = (env.EVAL_MODE?.trim() || "fake") as EvalMode;
  if (mode !== "fake" && mode !== "live") {
    throw new Error('EVAL_MODE must be "fake" or "live"');
  }
  const ownerUrl = required(env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  const appUrl = required(env.TEST_APP_DATABASE_URL, "TEST_APP_DATABASE_URL");
  const indexTokens = positiveInteger(
    env.EVAL_INDEX_TOKENS,
    DEFAULT_INDEX_TOKENS,
    "EVAL_INDEX_TOKENS",
  );
  const readTokens = positiveInteger(env.EVAL_READ_TOKENS, DEFAULT_READ_TOKENS, "EVAL_READ_TOKENS");
  const chatPrices = {
    inputPerMillionUsd: positiveRate(
      env.EVAL_CHAT_INPUT_USD_PER_M,
      DEFAULT_CHAT_PRICES.inputPerMillionUsd,
      "EVAL_CHAT_INPUT_USD_PER_M",
    ),
    outputPerMillionUsd: positiveRate(
      env.EVAL_CHAT_OUTPUT_USD_PER_M,
      DEFAULT_CHAT_PRICES.outputPerMillionUsd,
      "EVAL_CHAT_OUTPUT_USD_PER_M",
    ),
  };

  if (mode === "fake") {
    const chatModel = "fake-chat";
    const embeddingModel = "fake-embedding";
    return {
      mode,
      dataset,
      datasetPath,
      indexTokens,
      readTokens,
      ownerUrl,
      appUrl,
      compiler: {
        chatProvider: createDeterministicChat(),
        embeddingProvider: createFakeProvider(),
        chatModel,
        embeddingModel,
      },
      answerProvider: null,
      chatModel,
      chatPrices: DEFAULT_CHAT_PRICES,
      budget: null,
    };
  }

  const apiKey = required(env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");
  const embeddingKey = required(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const chatModel = pinnedModel(env.OPENROUTER_CHAT_MODEL, "OPENROUTER_CHAT_MODEL");
  const embeddingModel = pinnedModel(env.EMBEDDING_MODEL, "EMBEDDING_MODEL");
  const budget = new EvalBudget(positiveUsd(env.EVAL_BUDGET_USD), chatPrices);
  const chatProvider = guardChat(createOpenRouterChat({ apiKey }), budget);
  const embeddingProvider = guardEmbeddings(
    createOpenAIImbeddings({ apiKey: embeddingKey, model: embeddingModel, dimensions: 1536 }),
    budget,
  );

  return {
    mode,
    dataset,
    datasetPath,
    indexTokens,
    readTokens,
    ownerUrl,
    appUrl,
    compiler: {
      chatProvider,
      embeddingProvider,
      chatModel,
      embeddingModel,
      chatPrices,
      embeddingPrices: DEFAULT_EMBEDDING_PRICES,
    },
    answerProvider: chatProvider,
    chatModel,
    chatPrices,
    budget,
  };
}

async function main(): Promise<void> {
  const { dataset, path } = await loadDatasetFromEnv(process.env);
  const config = buildConfig(process.env, dataset, path);
  printResults(await runEval(config));
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`eval:smoke failed: ${message}\n`);
  process.exitCode = 1;
}
