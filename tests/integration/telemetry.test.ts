import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createFakeProvider } from "@memtavi/llm/fake";
import { createOpenAIImbeddings } from "@memtavi/llm/openai-embeddings";
import { createOpenRouterChat } from "@memtavi/llm/openrouter";
import { createLogger } from "@memtavi/shared/logging";
import { initTelemetry, shutdownTelemetry, telemetryEnabled } from "@memtavi/shared/telemetry";
import { createFakeStore } from "@memtavi/storage/fake";
import { createWorker } from "@memtavi/worker";
import { Pool } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
  spanContext(): { traceId: string; spanId: string };
  parentSpanContext?: { traceId: string; spanId: string } | undefined;
}

function memoryExporter() {
  const spans: RecordedSpan[] = [];
  return {
    spans,
    export(records: RecordedSpan[], callback: (result: { code: number }) => void) {
      spans.push(...records);
      callback({ code: 0 });
    },
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  };
}

const W3C_TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function traceparentOf(value: string) {
  const match = W3C_TRACEPARENT.exec(value);
  if (match === null) throw new Error("not a traceparent");
  return { traceId: match[1], spanId: match[2], flags: match[3] };
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("OpenTelemetry traces", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const store = createFakeStore();
  const memory = memoryExporter();
  const logs: string[] = [];
  const slug = `telemetry-${crypto.randomUUID()}`;
  const subjectId = crypto.randomUUID();
  const fixedNow = new Date("2026-11-07T00:00:00.000Z");
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let tenantId = "";
  let brainId = "";
  let apiKey = "";
  let fixturesAuthorized = false;

  function request(
    path: string,
    options: { method?: string; body?: unknown; requestId?: string } = {},
  ) {
    const headers = new Headers();
    headers.set("x-api-key", apiKey);
    headers.set("x-subject-id", subjectId);
    if (options.requestId !== undefined) headers.set("x-request-id", options.requestId);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  async function jobTrace(idempotencyKey: string): Promise<string | null> {
    const result = await owner.query<{ traceContext: string | null }>(
      `SELECT trace_context AS "traceContext" FROM jobs
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    return result.rows[0]?.traceContext ?? null;
  }

  function spanNamed(name: string): RecordedSpan | undefined {
    return memory.spans.find((span) => span.name === name);
  }

  function providerStub(): FetchImpl {
    const fake = createFakeProvider({ dimensions: 1536, embeddingModel: "fake-embedding" });
    function json(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return async (url, init) => {
      const body = JSON.parse(init.body as string) as {
        model: string;
        messages?: { content: string }[];
        input?: string[];
      };
      if (url.endsWith("/chat/completions")) {
        const input = JSON.parse(body.messages?.[1]?.content ?? "{}") as {
          chunks?: { chunkUuid: string; text: string }[];
          existing?: { title: string; summary: string; body: string };
        };
        const content = Array.isArray(input.chunks)
          ? JSON.stringify({
              facts: input.chunks.map((chunk) => ({
                claim: chunk.text.trim(),
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
              })),
            })
          : JSON.stringify({
              title: input.existing?.title ?? "",
              summary: input.existing?.summary ?? "",
              body: input.existing?.body ?? "",
              changed: false,
              contradictions: [],
            });
        return json({
          model: body.model,
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      }
      if (url.endsWith("/embeddings")) {
        const embedded = await fake.embed(body.input ?? []);
        return json({
          model: embedded.model,
          data: embedded.vectors.map((embedding, index) => ({ index, embedding })),
          usage: { prompt_tokens: embedded.usage.inputTokens },
        });
      }
      throw new Error("unexpected provider url");
    };
  }

  function worker() {
    const fetchImpl = providerStub();
    return createWorker({
      withTenant: db.withTenant,
      tenantIds: [tenantId],
      store,
      compiler: {
        chatModel: "stub-chat",
        embeddingModel: "fake-embedding",
        chatProvider: createOpenRouterChat({
          apiKey: "sk-telemetry-provider-secret",
          baseUrl: "http://stub.invalid/v1",
          fetchImpl,
        }),
        embeddingProvider: createOpenAIImbeddings({
          apiKey: "sk-telemetry-provider-secret",
          model: "fake-embedding",
          dimensions: 1536,
          baseUrl: "http://stub.invalid/v1",
          fetchImpl,
        }),
      },
      fetchDocument: async () => {
        throw new Error("network is forbidden");
      },
      random: () => 0,
      log: () => undefined,
    });
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Telemetry fixtures require a disposable memtavi_test database");
    }
    const role = await application.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    fixturesAuthorized = true;

    process.env.APP_DATABASE_URL = appUrl;
    db = await import("@memtavi/db/client");
    await db.pool.query("SELECT 1");

    initTelemetry({ exporter: memory, serviceName: "telemetry-test" });
    app = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store,
      now: () => fixedNow,
      logger: createLogger({
        level: "info",
        stream: { write: (line) => logs.push(line) },
      }),
    });

    apiKey = await bootstrap(owner, "Telemetry", slug);
    const tenant = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [
      slug,
    ]);
    tenantId = tenant.rows[0]?.id ?? "";
    const brain = await request("/v1/brains", {
      method: "POST",
      body: { name: "Telemetry Brain", slug: `brain-${crypto.randomUUID()}` },
    });
    expect(brain.status).toBe(201);
    brainId = ((await brain.json()) as { id: string }).id;
  });

  afterAll(async () => {
    await shutdownTelemetry();
    if (fixturesAuthorized) {
      const actors = await owner.query<{ created_by: string }>(
        `SELECT k.created_by FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
         WHERE t.slug = $1`,
        [slug],
      );
      await owner.query("DELETE FROM tenants WHERE slug = $1", [slug]);
      await owner.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [...new Set(actors.rows.map((row) => row.created_by))],
      ]);
    }
    await Promise.all([owner.end(), application.end()]);
  });

  test("one trace joins the request, both jobs and every provider call without leaking data", async () => {
    memory.spans.length = 0;
    logs.length = 0;
    const note = "The telemetry probe keeps one trace across the queue.";

    const response = await request(`/v1/brains/${brainId}/captures`, {
      method: "POST",
      body: { kind: "note", content: note },
    });
    expect(response.status).toBe(201);
    const source = (await response.json()) as { id: string };

    const server = spanNamed("POST /v1/brains/:brainId/captures");
    expect(memory.spans.map((span) => span.name)).toContain("POST /v1/brains/:brainId/captures");
    expect(server).toBeDefined();
    const traceId = server?.spanContext().traceId ?? "";
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(server?.attributes).toMatchObject({
      "http.request.method": "POST",
      "http.route": "/v1/brains/:brainId/captures",
      "http.response.status_code": 201,
    });
    expect(typeof server?.attributes["request.id"]).toBe("string");

    const ingestContext = await jobTrace(`capture:${source.id}`);
    expect(ingestContext).not.toBeNull();
    expect(traceparentOf(ingestContext ?? "").traceId).toBe(traceId);

    const instance = worker();
    expect(await instance.runOnce()).toBe(true);

    const ingestSpan = spanNamed("job capture.ingest");
    expect(ingestSpan).toBeDefined();
    expect(ingestSpan?.parentSpanContext?.spanId).toBe(server?.spanContext().spanId);

    const compileContext = await jobTrace(`compile:${source.id}`);
    expect(compileContext).not.toBeNull();
    const compileParent = traceparentOf(compileContext ?? "");
    expect(compileParent.traceId).toBe(traceId);
    expect(compileParent.spanId).toBe(ingestSpan?.spanContext().spanId);

    expect(await instance.runOnce()).toBe(true);

    const compileSpan = spanNamed("job capture.compile");
    expect(compileSpan).toBeDefined();
    expect(compileSpan?.parentSpanContext?.spanId).toBe(ingestSpan?.spanContext().spanId);
    expect(compileSpan?.attributes).toMatchObject({
      "job.type": "capture.compile",
      "job.outcome": "completed",
    });

    const providerSpans = memory.spans.filter((span) => span.name.startsWith("provider."));
    expect(providerSpans.length).toBeGreaterThanOrEqual(3);
    for (const span of providerSpans) {
      expect(span.spanContext().traceId).toBe(traceId);
      expect(span.parentSpanContext?.spanId).toBe(compileSpan?.spanContext().spanId);
    }
    const chat = providerSpans.find((span) => span.name === "provider.chat");
    expect(chat?.attributes).toMatchObject({
      provider: "openrouter",
      model: "stub-chat",
      input_tokens: 10,
      output_tokens: 5,
      status_code: 200,
    });
    const embeddings = providerSpans.filter((span) => span.name === "provider.embeddings");
    expect(embeddings.length).toBeGreaterThanOrEqual(2);
    for (const span of embeddings) {
      expect(span.attributes).toMatchObject({ provider: "openai", model: "fake-embedding" });
      expect(typeof span.attributes.input_tokens).toBe("number");
      expect(span.attributes.status_code).toBe(200);
    }

    const missing = await request(`/v1/brains/brn_${"0".repeat(32)}/score`);
    expect(missing.status).toBe(404);
    expect(spanNamed("GET /v1/brains/:brainId/score")?.attributes).toMatchObject({
      "http.response.status_code": 404,
    });

    const forbidden = [apiKey, subjectId, note, "sk-telemetry-provider-secret"];
    for (const span of memory.spans) {
      const serialized = JSON.stringify({ name: span.name, attributes: span.attributes });
      for (const value of forbidden) expect(serialized).not.toContain(value);
      expect(Object.keys(span.attributes)).not.toContain("authorization");
      expect(Object.keys(span.attributes)).not.toContain("x-api-key");
    }

    const requestLog = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record.msg === "request" && String(record.path).endsWith("/captures"));
    expect(requestLog?.traceId).toBe(traceId);
    expect(JSON.stringify(requestLog)).not.toContain(apiKey);
    expect(JSON.stringify(requestLog)).not.toContain(note);
  });

  test("concurrent requests keep their own trace context and job parent", async () => {
    memory.spans.length = 0;
    logs.length = 0;
    const ids = { a: crypto.randomUUID(), b: crypto.randomUUID(), idle: crypto.randomUUID() };

    function serverSpan(requestId: string): RecordedSpan | undefined {
      return memory.spans.find((span) => span.attributes["request.id"] === requestId);
    }

    function logged(requestId: string): Record<string, unknown> | undefined {
      return logs
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((record) => record.msg === "request" && record.requestId === requestId);
    }

    function flushAfterResponse(): Promise<void> {
      return new Promise((resolve) => setImmediate(resolve));
    }

    const [first, second] = await Promise.all([
      request(`/v1/brains/${brainId}/captures`, {
        method: "POST",
        requestId: ids.a,
        body: { kind: "note", content: "Concurrent trace A." },
      }),
      request(`/v1/brains/${brainId}/captures`, {
        method: "POST",
        requestId: ids.b,
        body: { kind: "note", content: "Concurrent trace B." },
      }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const sources = {
      a: ((await first.json()) as { id: string }).id,
      b: ((await second.json()) as { id: string }).id,
    };

    const spanA = serverSpan(ids.a);
    const spanB = serverSpan(ids.b);
    expect(spanA).toBeDefined();
    expect(spanB).toBeDefined();
    const traceA = spanA?.spanContext().traceId ?? "";
    const traceB = spanB?.spanContext().traceId ?? "";
    expect(traceA).not.toBe(traceB);

    expect(traceparentOf((await jobTrace(`capture:${sources.a}`)) ?? "").traceId).toBe(traceA);
    expect(traceparentOf((await jobTrace(`capture:${sources.b}`)) ?? "").traceId).toBe(traceB);

    const idle = await request(`/v1/brains/${brainId}/score`, { requestId: ids.idle });
    expect(idle.status).toBe(200);
    const spanIdle = serverSpan(ids.idle);
    expect(spanIdle).toBeDefined();
    const traceIdle = spanIdle?.spanContext().traceId ?? "";
    expect(traceIdle).not.toBe(traceA);
    expect(traceIdle).not.toBe(traceB);

    await flushAfterResponse();
    expect(logged(ids.a)?.traceId).toBe(traceA);
    expect(logged(ids.b)?.traceId).toBe(traceB);
    expect(logged(ids.idle)?.traceId).toBe(traceIdle);

    const traces = new Set([traceA, traceB, traceIdle]);
    for (const span of memory.spans) expect(traces.has(span.spanContext().traceId)).toBe(true);
    expect(memory.spans).toHaveLength(3);
  });

  test("telemetry off records no spans, stores no trace context and still serves the request", async () => {
    await shutdownTelemetry();
    expect(telemetryEnabled()).toBe(false);
    const before = memory.spans.length;

    const response = await request(`/v1/brains/${brainId}/captures`, {
      method: "POST",
      body: { kind: "note", content: "A capture with tracing disabled." },
    });
    expect(response.status).toBe(201);
    const source = (await response.json()) as { id: string };

    expect(memory.spans).toHaveLength(before);
    expect(await jobTrace(`capture:${source.id}`)).toBeNull();
  });
});
