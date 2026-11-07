import { expect, test } from "bun:test";
import type { FetchImpl } from "./http";
import { createOpenRouterChat } from "./openrouter";
import { ProviderError } from "./provider";

interface Captured {
  url: string;
  init: RequestInit;
}

function capture(response: () => Response): { fetchImpl: FetchImpl; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response();
    },
  };
}

function completion(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "gen-1",
    model: "test/chat-model",
    choices: [{ message: { role: "assistant", content: "hello world" } }],
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    ...overrides,
  });
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("expected a recorded call");
  return value;
}

function bodyOf(call: Captured): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

test("posts to chat/completions with the key, messages and pinned model", async () => {
  const { fetchImpl, calls } = capture(() => new Response(completion(), { status: 200 }));
  const chat = createOpenRouterChat({ apiKey: "test-key", fetchImpl });

  await chat.chat({
    model: "test/chat-model",
    messages: [
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ],
  });

  expect(calls).toHaveLength(1);
  const call = first(calls);
  expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(call.init.method).toBe("POST");
  expect(call.init.headers).toEqual({
    accept: "application/json",
    authorization: "Bearer test-key",
    "content-type": "application/json",
  });
  expect(bodyOf(call)).toEqual({
    model: "test/chat-model",
    messages: [
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ],
    temperature: 0,
  });
});

test("omits response_format unless json was requested", async () => {
  const plain = capture(() => new Response(completion(), { status: 200 }));
  await createOpenRouterChat({ apiKey: "k", fetchImpl: plain.fetchImpl }).chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  });
  expect(bodyOf(first(plain.calls))).not.toHaveProperty("response_format");

  const json = capture(() => new Response(completion(), { status: 200 }));
  await createOpenRouterChat({ apiKey: "k", fetchImpl: json.fetchImpl }).chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    responseFormat: "json",
  });
  expect(bodyOf(first(json.calls)).response_format).toEqual({ type: "json_object" });
});

test("parses the text, usage and the model the provider actually used", async () => {
  const { fetchImpl } = capture(
    () => new Response(completion({ model: "test/chat-model-0613" }), { status: 200 }),
  );
  const chat = createOpenRouterChat({ apiKey: "k", fetchImpl });

  const result = await chat.chat({ model: "test/chat-model", messages: [] });

  expect(result).toEqual({
    text: "hello world",
    model: "test/chat-model-0613",
    usage: { inputTokens: 12, outputTokens: 7 },
  });
});

test("falls back to the requested model when the provider omits one", async () => {
  const { fetchImpl } = capture(
    () => new Response(completion({ model: undefined }), { status: 200 }),
  );
  const result = await createOpenRouterChat({ apiKey: "k", fetchImpl }).chat({
    model: "test/chat-model",
    messages: [],
  });
  expect(result.model).toBe("test/chat-model");
});

test("honours a custom base URL without doubling the slash", async () => {
  const { fetchImpl, calls } = capture(() => new Response(completion(), { status: 200 }));
  await createOpenRouterChat({
    apiKey: "k",
    baseUrl: "https://gateway.example/v1/",
    fetchImpl,
  }).chat({ model: "m", messages: [] });
  expect(first(calls).url).toBe("https://gateway.example/v1/chat/completions");
});

test("a 429 is transient and uses the rate_limited code", async () => {
  const { fetchImpl, calls } = capture(() => new Response("slow down", { status: 429 }));
  const error = await createOpenRouterChat({ apiKey: "k", fetchImpl })
    .chat({ model: "m", messages: [] })
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({ code: "rate_limited", transient: true, status: 429 });
  expect(calls).toHaveLength(1);
});

test.each([500, 502, 503])("a %d is transient and uses the server_error code", async (status) => {
  const { fetchImpl } = capture(() => new Response("upstream broke", { status }));
  const error = await createOpenRouterChat({ apiKey: "k", fetchImpl })
    .chat({ model: "m", messages: [] })
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "server_error", transient: true, status });
});

test.each([400, 401, 403, 404, 422])(
  "a %d is permanent and uses the bad_request code",
  async (status) => {
    const { fetchImpl, calls } = capture(() => new Response("rejected", { status }));
    const error = await createOpenRouterChat({ apiKey: "k", fetchImpl })
      .chat({ model: "m", messages: [] })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "bad_request", transient: false, status });
    expect(calls).toHaveLength(1);
  },
);

test.each([
  ["non-json", "not json at all"],
  ["an empty object", JSON.stringify({})],
  ["no choices", JSON.stringify({ choices: [], usage: {} })],
  ["no message", JSON.stringify({ choices: [{}], usage: {} })],
  [
    "non-string content",
    JSON.stringify({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  ],
  ["missing usage", JSON.stringify({ choices: [{ message: { content: "x" } }] })],
  [
    "negative usage",
    JSON.stringify({
      choices: [{ message: { content: "x" } }],
      usage: { prompt_tokens: -1, completion_tokens: 1 },
    }),
  ],
])("treats a malformed body (%s) as a permanent error", async (_label, body) => {
  const { fetchImpl } = capture(() => new Response(body, { status: 200 }));
  const error = await createOpenRouterChat({ apiKey: "k", fetchImpl })
    .chat({ model: "m", messages: [] })
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "malformed_response", transient: false });
});

test("a transport failure is transient", async () => {
  const fetchImpl: FetchImpl = async () => {
    throw new TypeError("socket closed");
  };
  const error = await createOpenRouterChat({ apiKey: "k", fetchImpl })
    .chat({ model: "m", messages: [] })
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "network", transient: true });
});

test("an aborted request is a transient timeout", async () => {
  const hanging: FetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const error = await createOpenRouterChat({ apiKey: "k", fetchImpl: hanging, timeoutMs: 5 })
    .chat({ model: "m", messages: [] })
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "timeout", transient: true });
});

test("the provider error message never carries the response body or the key", async () => {
  const { fetchImpl } = capture(
    () => new Response(JSON.stringify({ error: { message: "sk-secret-leak" } }), { status: 500 }),
  );
  const error: unknown = await createOpenRouterChat({ apiKey: "sk-secret-leak", fetchImpl })
    .chat({ model: "m", messages: [] })
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(ProviderError);
  expect((error as ProviderError).message).not.toContain("sk-secret-leak");
  expect((error as ProviderError).message).not.toContain("upstream");
});
