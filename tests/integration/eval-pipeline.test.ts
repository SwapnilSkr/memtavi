import { describe, expect, test } from "bun:test";
import type { ExtractedFact } from "@memtavi/core/compile/schemas";
import { createFakeProvider } from "@memtavi/llm/fake";
import { ProviderError } from "@memtavi/llm/provider";
import { createFakeStore } from "@memtavi/storage/fake";
import { EvalPipeline } from "../eval/src/pipeline";

describe("eval source retries", () => {
  test.each([
    { failure: "transient", failures: 1, calls: 2, completed: true },
    { failure: "transient", failures: 2, calls: 3, completed: true },
    { failure: "transient", failures: 3, calls: 3, completed: false },
    { failure: "permanent", failures: 1, calls: 1, completed: false },
    { failure: "embedding", failures: 1, calls: 2, completed: true },
  ] as const)("$failure with $failures failures uses $calls attempts", async (fixture) => {
    const ownerUrl = process.env.TEST_DATABASE_URL;
    const appUrl = process.env.TEST_APP_DATABASE_URL;
    if (!ownerUrl || !appUrl) throw new Error("Both test database URLs are required");
    const provider = createFakeProvider();
    let attempts = 0;
    let failures = 0;
    const pipeline = await EvalPipeline.open({
      ownerUrl,
      appUrl,
      store: createFakeStore(),
      compiler: {
        chatModel: "fake-chat",
        embeddingModel: "fake-embedding",
        chatProvider: {
          chat: async (request) => {
            attempts += 1;
            if (fixture.failure !== "embedding" && failures < fixture.failures) {
              failures += 1;
              throw new ProviderError(
                fixture.failure === "transient" ? "server_error" : "bad_request",
                fixture.failure === "transient",
                "private detail",
              );
            }
            const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
              chunks: { chunkUuid: string; text: string }[];
            };
            const facts: ExtractedFact[] = input.chunks.map((chunk) => ({
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
            provider.queueChat(JSON.stringify({ facts }));
            return provider.chat(request);
          },
        },
        embeddingProvider: {
          embed: async (texts) => {
            if (
              fixture.failure === "embedding" &&
              texts.some((text) => text.includes("## Sources")) &&
              failures < fixture.failures
            ) {
              failures += 1;
              throw new ProviderError("server_error", true, "private detail");
            }
            return provider.embed(texts);
          },
        },
      },
    });
    try {
      const result = await pipeline.compileConversation(
        {
          id: "retry",
          sessions: [{ turns: [{ speaker: "Alice", text: "The compiler preserves evidence." }] }],
        },
        0,
      );
      expect(attempts).toBe(fixture.calls);
      expect(failures).toBe(fixture.failures);
      expect(result.counts).toEqual({
        sourcesCompleted: fixture.completed ? 1 : 0,
        sourcesFailed: fixture.completed ? 0 : 1,
        pages: fixture.completed ? 1 : 0,
        pageVersions: fixture.completed ? 1 : 0,
        routingReviews: 0,
      });
      expect(result.failures).toHaveLength(fixture.completed ? 0 : 1);
      expect(result.routing).toHaveLength(fixture.completed ? 1 : 0);
      const sources = await pipeline.withScope((client) =>
        client.query<{ status: string; last_error: string | null }>(
          "SELECT status, last_error FROM ingest_sources WHERE tenant_id = $1 AND brain_id = $2",
          [pipeline.tenantId, result.brainId],
        ),
      );
      expect(sources.rows).toEqual([
        {
          status: fixture.completed ? "completed" : "failed",
          last_error: fixture.completed ? null : "Compiler provider failed",
        },
      ]);
    } finally {
      try {
        await pipeline.cleanup();
      } finally {
        await pipeline.close();
      }
    }
  });
});
