import { expect, test } from "bun:test";
import type { FetchImpl } from "./http";
import { createOpenAIImbeddings, MAX_EMBEDDING_BATCH } from "./openai-embeddings";
import { ProviderError } from "./provider";

interface EmbeddingRequest {
  url: string;
  headers: unknown;
  body: {
    model: string;
    input: string[];
    dimensions: number;
  };
}

function embeddingResponse(
  request: EmbeddingRequest,
  options: {
    model?: string | undefined;
    omitModel?: boolean;
    dimensions?: number;
    reverse?: boolean;
  } = {},
): Response {
  const dimensions = options.dimensions ?? request.body.dimensions;
  const data = request.body.input.map((text, index) => ({
    object: "embedding",
    index,
    embedding: Array.from({ length: dimensions }, (_value, position) =>
      position === 0 ? Number(text.slice(1)) : position,
    ),
  }));
  if (options.reverse === true) data.reverse();
  return new Response(
    JSON.stringify({
      object: "list",
      ...(options.omitModel === true ? {} : { model: options.model ?? "test/embedding-model" }),
      data,
      usage: { prompt_tokens: request.body.input.length, total_tokens: request.body.input.length },
    }),
    { status: 200 },
  );
}

function recordingServer(
  options: {
    model?: string | undefined;
    omitModel?: boolean;
    dimensions?: number;
    reverse?: boolean;
  } = {},
): { fetchImpl: FetchImpl; requests: EmbeddingRequest[] } {
  const requests: EmbeddingRequest[] = [];
  return {
    requests,
    fetchImpl: async (url, init) => {
      const request: EmbeddingRequest = {
        url,
        headers: init.headers,
        body: JSON.parse(init.body as string) as EmbeddingRequest["body"],
      };
      requests.push(request);
      return embeddingResponse(request, options);
    },
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("expected a recorded request");
  return value;
}

test("posts one batch to embeddings with the key, model and dimensions", async () => {
  const { fetchImpl, requests } = recordingServer();
  const embeddings = createOpenAIImbeddings({
    apiKey: "test-key",
    model: "text-embedding-3-small",
    dimensions: 3,
    fetchImpl,
  });

  const result = await embeddings.embed(["t0", "t1", "t2"]);

  expect(requests).toHaveLength(1);
  expect(first(requests).url).toBe("https://api.openai.com/v1/embeddings");
  expect(first(requests).headers).toEqual({
    accept: "application/json",
    authorization: "Bearer test-key",
    "content-type": "application/json",
  });
  expect(first(requests).body).toEqual({
    model: "text-embedding-3-small",
    input: ["t0", "t1", "t2"],
    dimensions: 3,
  });
  expect(result).toEqual({
    vectors: [
      [0, 1, 2],
      [1, 1, 2],
      [2, 1, 2],
    ],
    model: "test/embedding-model",
    dimensions: 3,
    usage: { inputTokens: 3 },
  });
});

test("returns vectors in input order even when the provider replies out of order", async () => {
  const { fetchImpl } = recordingServer({ reverse: true });
  const result = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  }).embed(["t0", "t1", "t2"]);

  expect(result.vectors.map((vector) => vector[0])).toEqual([0, 1, 2]);
});

test("splits more than 64 inputs into ordered batches and sums the usage", async () => {
  const { fetchImpl, requests } = recordingServer();
  const texts = Array.from({ length: 130 }, (_value, index) => `t${index}`);

  const result = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  }).embed(texts);

  expect(MAX_EMBEDDING_BATCH).toBe(64);
  expect(requests.map((request) => request.body.input.length)).toEqual([64, 64, 2]);
  expect(result.vectors).toHaveLength(130);
  expect(result.vectors.map((vector) => vector[0])).toEqual(texts.map((_text, index) => index));
  expect(result.usage.inputTokens).toBe(130);
});

test("uses an empty batch without calling the provider", async () => {
  let fetched = 0;
  const result = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 4,
    fetchImpl: async () => {
      fetched += 1;
      return new Response("never");
    },
  }).embed([]);

  expect(fetched).toBe(0);
  expect(result).toEqual({
    vectors: [],
    model: "m",
    dimensions: 4,
    usage: { inputTokens: 0 },
  });
});

test("falls back to the configured model when the response omits it", async () => {
  const { fetchImpl } = recordingServer({ omitModel: true });
  const result = await createOpenAIImbeddings({
    apiKey: "k",
    model: "configured-model",
    dimensions: 3,
    fetchImpl,
  }).embed(["t0"]);
  expect(result.model).toBe("configured-model");
});

test("rejects a vector whose length differs from the configured dimensions", async () => {
  const { fetchImpl } = recordingServer({ dimensions: 2 });
  const error = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  })
    .embed(["t0"])
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({ code: "dimension_mismatch", transient: false });
});

test("rejects a response with the wrong number of vectors", async () => {
  const fetchImpl: FetchImpl = async () =>
    new Response(
      JSON.stringify({
        data: [{ index: 0, embedding: [0, 1, 2] }],
        usage: { prompt_tokens: 1 },
      }),
      { status: 200 },
    );

  const error = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  })
    .embed(["t0", "t1"])
    .catch((cause: unknown) => cause);

  expect(error).toMatchObject({ code: "malformed_response", transient: false });
});

test("rejects a duplicated index", async () => {
  const fetchImpl: FetchImpl = async () =>
    new Response(
      JSON.stringify({
        data: [
          { index: 0, embedding: [0, 1, 2] },
          { index: 0, embedding: [1, 1, 2] },
        ],
        usage: { prompt_tokens: 2 },
      }),
      { status: 200 },
    );

  const error = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  })
    .embed(["t0", "t1"])
    .catch((cause: unknown) => cause);

  expect(error).toMatchObject({ code: "malformed_response", transient: false });
});

test("rejects a body that is not json", async () => {
  const fetchImpl: FetchImpl = async () => new Response("<html>oops</html>", { status: 200 });
  const error = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  })
    .embed(["t0"])
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "malformed_response", transient: false });
});

test("a 429 is transient", async () => {
  const fetchImpl: FetchImpl = async () => new Response("slow down", { status: 429 });
  const error = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  })
    .embed(["t0"])
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "rate_limited", transient: true });
});

test("a 400 is permanent", async () => {
  const fetchImpl: FetchImpl = async () => new Response("bad input", { status: 400 });
  const error = await createOpenAIImbeddings({
    apiKey: "k",
    model: "m",
    dimensions: 3,
    fetchImpl,
  })
    .embed(["t0"])
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "bad_request", transient: false });
});

test("rejects a dimensions option that is not a positive integer", () => {
  expect(() => createOpenAIImbeddings({ apiKey: "k", model: "m", dimensions: 0 })).toThrow(
    RangeError,
  );
  expect(() => createOpenAIImbeddings({ apiKey: "k", model: "m", dimensions: 2.5 })).toThrow(
    RangeError,
  );
});
