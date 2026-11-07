import type { ChatMessage } from "@memtavi/llm/provider";
import { CompileError } from "./errors";
import { prompts, promptVersion } from "./prompts";
import { type ExtractedFact, type PatchResult, patchResultSchema } from "./schemas";

export interface ExistingPage {
  title: string;
  summary: string;
  body: string;
}

export interface PatchOptions {
  userEdited: boolean;
  facts?: readonly ExtractedFact[];
}

export interface PatchDecision extends ExistingPage {
  action: "contested" | "unchanged" | "append" | "rewrite";
  changed: boolean;
  contradictions: PatchResult["contradictions"];
}

export function buildPatchMessages(
  existing: ExistingPage,
  facts: readonly ExtractedFact[],
  options: { userEdited: boolean; promptVersion: string },
): ChatMessage[] {
  if (options.promptVersion !== promptVersion("patch")) throw new CompileError();
  const ordered = [...facts].sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return [
    { role: "system", content: prompts.patch },
    {
      role: "user",
      content: JSON.stringify({ ...options, existing, facts: ordered }),
    },
  ];
}

export function parsePatchResult(text: string): PatchResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CompileError();
  }
  const result = patchResultSchema.safeParse(parsed);
  if (!result.success) throw new CompileError();
  return result.data;
}

export function applyPatch(
  existing: ExistingPage,
  patch: PatchResult,
  options: PatchOptions,
): PatchDecision {
  if (patch.contradictions.length > 0) {
    return {
      ...existing,
      action: "contested",
      changed: false,
      contradictions: [...patch.contradictions],
    };
  }
  if (!patch.changed)
    return { ...existing, action: "unchanged", changed: false, contradictions: [] };
  const sources = [
    ...new Set(
      (options.facts ?? []).map(
        ({ evidence }) =>
          `- ${evidence.chunkUuid}:${evidence.charStart}-${evidence.charEnd} ${JSON.stringify(evidence.quote)}`,
      ),
    ),
  ]
    .sort()
    .join("\n");
  const body = `${patch.body.trimEnd()}\n\n## Sources\n${sources}`;
  if (options.userEdited) {
    return {
      ...existing,
      body: `${existing.body}\n\n## Updates\n\n${body}`,
      action: "append",
      changed: true,
      contradictions: [],
    };
  }
  return {
    title: patch.title,
    summary: patch.summary,
    body,
    action: "rewrite",
    changed: true,
    contradictions: [],
  };
}
