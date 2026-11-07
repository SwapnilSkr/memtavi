import { fileURLToPath } from "node:url";
import { z } from "../../../packages/core/node_modules/zod";
import type { Conversation, Dataset, Question, Session, Turn } from "./types";

const turnSchema = z.object({
  speaker: z.string().min(1),
  text: z.string().min(1),
});

const sessionSchema = z.object({
  turns: z.array(turnSchema).min(1),
});

const conversationSchema = z.object({
  id: z.string().min(1),
  sessions: z.array(sessionSchema).min(1),
});

const questionSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  category: z.string().min(1),
});

const datasetSchema = z
  .object({
    name: z.string().min(1),
    conversations: z.array(conversationSchema).min(1),
    questions: z.array(questionSchema).min(1),
  })
  .superRefine((value, context) => {
    const conversationIds = new Set<string>();
    for (const [index, conversation] of value.conversations.entries()) {
      if (conversationIds.has(conversation.id)) {
        context.addIssue({
          code: "custom",
          message: "Conversation ids must be unique",
          path: ["conversations", index, "id"],
        });
      }
      conversationIds.add(conversation.id);
    }
    const questionIds = new Set<string>();
    for (const [index, question] of value.questions.entries()) {
      if (questionIds.has(question.id)) {
        context.addIssue({
          code: "custom",
          message: "Question ids must be unique",
          path: ["questions", index, "id"],
        });
      }
      questionIds.add(question.id);
      if (!conversationIds.has(question.conversationId)) {
        context.addIssue({
          code: "custom",
          message: "Question references an unknown conversation",
          path: ["questions", index, "conversationId"],
        });
      }
    }
  });

export const DEFAULT_DATASET_PATH = fileURLToPath(
  new URL("../fixtures/smoke.json", import.meta.url),
);

export function parseDataset(raw: unknown, source = "dataset"): Dataset {
  const result = datasetSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid eval dataset ${source}: ${detail}`);
  }
  return result.data;
}

export async function loadDatasetFile(path: string): Promise<Dataset> {
  const text = await Bun.file(path).text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Eval dataset is not valid JSON: ${path}`);
  }
  return parseDataset(raw, path);
}

const LOCOMO_CATEGORIES: Record<number, string> = {
  1: "multi-hop",
  2: "temporal",
  3: "open-domain",
  4: "single-hop",
  5: "adversarial",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function categoryLabel(value: unknown): string {
  if (typeof value === "number" && LOCOMO_CATEGORIES[value] !== undefined) {
    return LOCOMO_CATEGORIES[value];
  }
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "uncategorised";
}

function sampleArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) {
    if (Array.isArray(raw.data)) return raw.data;
    return Object.values(raw);
  }
  throw new Error("LoCoMo dataset must be an object or an array");
}

// LoCoMo ships one sample per conversation with `session_<n>` turn arrays and a
// flat `qa` list. The mapping is best-effort: numeric categories become labels,
// answers are stringified, and samples without usable sessions or questions are
// skipped rather than failing the whole file.
export function adaptLocomo(raw: unknown): Dataset {
  const conversations: Conversation[] = [];
  const questions: Question[] = [];

  for (const [sampleIndex, candidate] of sampleArray(raw).entries()) {
    if (!isRecord(candidate)) continue;
    const conversationId = String(
      candidate.sample_id ?? candidate.id ?? `locomo-${sampleIndex + 1}`,
    );
    const source = isRecord(candidate.conversation) ? candidate.conversation : candidate;

    const sessions: { ordinal: number; session: Session }[] = [];
    for (const [key, value] of Object.entries(source)) {
      const match = /^session_(\d+)$/.exec(key);
      if (!match || !Array.isArray(value)) continue;
      const turns: Turn[] = [];
      for (const turn of value) {
        if (!isRecord(turn)) continue;
        const speaker =
          typeof turn.speaker === "string"
            ? turn.speaker
            : typeof turn.speaker_name === "string"
              ? turn.speaker_name
              : "";
        const text = typeof turn.text === "string" ? turn.text : "";
        if (speaker.length > 0 && text.length > 0) turns.push({ speaker, text });
      }
      if (turns.length > 0) {
        sessions.push({ ordinal: Number(match[1]), session: { turns } });
      }
    }
    if (sessions.length === 0) continue;
    sessions.sort((left, right) => left.ordinal - right.ordinal);
    conversations.push({
      id: conversationId,
      sessions: sessions.map((entry) => entry.session),
    });

    if (!Array.isArray(candidate.qa)) continue;
    for (const [qaIndex, item] of candidate.qa.entries()) {
      if (!isRecord(item)) continue;
      const question = typeof item.question === "string" ? item.question : "";
      const rawAnswer = item.answer;
      const answer =
        typeof rawAnswer === "string"
          ? rawAnswer
          : typeof rawAnswer === "number"
            ? String(rawAnswer)
            : "";
      if (question.length === 0 || answer.length === 0) continue;
      questions.push({
        id: `${conversationId}-q${qaIndex + 1}`,
        conversationId,
        question,
        answer,
        category: categoryLabel(item.category),
      });
    }
  }

  if (questions.length === 0) {
    throw new Error("LoCoMo dataset contains no usable questions");
  }
  return { name: "locomo", conversations, questions };
}

export async function loadLocomoFile(path: string): Promise<Dataset> {
  const text = await Bun.file(path).text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`LoCoMo dataset is not valid JSON: ${path}`);
  }
  return adaptLocomo(raw);
}

export type DatasetEnv = Record<string, string | undefined>;

export async function loadDatasetFromEnv(
  env: DatasetEnv,
): Promise<{ dataset: Dataset; path: string }> {
  const locomoPath = env.LOCOMO_PATH?.trim();
  if (locomoPath) return { dataset: await loadLocomoFile(locomoPath), path: locomoPath };
  const path = env.EVAL_DATASET?.trim() || DEFAULT_DATASET_PATH;
  return { dataset: await loadDatasetFile(path), path };
}
