import type { ChatMessage } from "@memtavi/llm/provider";
import { CompileError } from "./errors";
import { prompts, promptVersion } from "./prompts";
import { type ConnectionJudgement, connectionResultSchema } from "./schemas";

export interface ConnectionPage {
  id: string;
  title: string;
  summary: string;
  body: string;
}

export interface ConnectionPair {
  pageA: ConnectionPage;
  pageB: ConnectionPage;
  similarity: number;
}

export function buildConnectMessages(pairs: readonly ConnectionPair[]): ChatMessage[] {
  return [
    { role: "system", content: prompts.connect },
    {
      role: "user",
      content: JSON.stringify({
        promptVersion: promptVersion("connect"),
        pairs: [...pairs].sort((left, right) => {
          const a = `${left.pageA.id}:${left.pageB.id}`;
          const b = `${right.pageA.id}:${right.pageB.id}`;
          return a < b ? -1 : a > b ? 1 : 0;
        }),
      }),
    },
  ];
}

export function parseConnectResult(
  text: string,
  pairs: readonly ConnectionPair[],
): (ConnectionJudgement & { strength: "strong" | "medium" | "weak" })[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CompileError();
  }
  const result = connectionResultSchema.safeParse(parsed);
  if (!result.success) throw new CompileError();
  const expected = new Set(pairs.map(({ pageA, pageB }) => `${pageA.id}:${pageB.id}`));
  if (expected.size !== pairs.length || result.data.connections.length !== expected.size) {
    throw new CompileError();
  }
  for (const row of result.data.connections) {
    if (row.pageAId >= row.pageBId || !expected.delete(`${row.pageAId}:${row.pageBId}`)) {
      throw new CompileError();
    }
  }
  return result.data.connections
    .flatMap((row) => (row.strength === "noise" ? [] : [{ ...row, strength: row.strength }]))
    .sort((left, right) => {
      const a = `${left.pageAId}:${left.pageBId}`;
      const b = `${right.pageAId}:${right.pageBId}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
}
