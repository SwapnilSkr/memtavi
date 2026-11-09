import { describe, expect, test } from "bun:test";
import { createClient, type FetchLike } from "./client";

interface Recorded {
  url: string;
  init: RequestInit;
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function recordingFetch(response: Response | (() => Response)) {
  const recorded: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    recorded.push({ url, init });
    return typeof response === "function" ? response() : response;
  };
  return { fetchImpl, recorded };
}

const base = { apiUrl: "https://api.example.com", apiKey: "mtv_live_secret", subjectId: "sub_1" };

const errorEnvelope = (statusCode: number, message: string, error: string) => ({
  statusCode,
  timestamp: "2026-11-06T10:00:00.000Z",
  path: "/v1/brains",
  message,
  body: { message, error, statusCode },
});

describe("createClient", () => {
  test("injects both auth headers and accepts the response", async () => {
    const { fetchImpl, recorded } = recordingFetch(
      jsonResponse({
        items: [{ id: "brn_1", name: "B", slug: "b" }],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    );
    const client = createClient({ ...base, fetch: fetchImpl });
    const result = await client.listBrains();

    expect(result.items[0]?.id).toBe("brn_1");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains");
    const headers = recorded[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("mtv_live_secret");
    expect(headers["x-subject-id"]).toBe("sub_1");
  });

  test("strips a trailing slash from the base URL", async () => {
    const { fetchImpl, recorded } = recordingFetch(
      jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }),
    );
    const client = createClient({ ...base, apiUrl: "https://api.example.com/", fetch: fetchImpl });
    await client.listBrains();
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains");
  });

  test("sends the index limit only when supplied", async () => {
    const payload = { items: [], total: 0, limit: 40, offset: 0 };
    const withLimit = recordingFetch(jsonResponse(payload));
    await createClient({ ...base, fetch: withLimit.fetchImpl }).getIndex("brn_1", 12);
    expect(withLimit.recorded[0]?.url).toBe(
      "https://api.example.com/v1/brains/brn_1/index?limit=12",
    );

    const withoutLimit = recordingFetch(jsonResponse(payload));
    await createClient({ ...base, fetch: withoutLimit.fetchImpl }).getIndex("brn_1");
    expect(withoutLimit.recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/index");
  });

  test("serialises the search query and omits an absent minSimilarity", async () => {
    const payload = { items: [], total: 0, limit: 10, offset: 0 };
    const { fetchImpl, recorded } = recordingFetch(() => jsonResponse(payload));
    const client = createClient({ ...base, fetch: fetchImpl });

    await client.search("brn_1", { q: "vector search", limit: 5 });
    const url = new URL(recorded[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/brains/brn_1/search");
    expect(url.searchParams.get("q")).toBe("vector search");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("minSimilarity")).toBe(false);

    await client.search("brn_1", { q: "x", minSimilarity: 0.7 });
    const second = new URL(recorded[1]?.url ?? "");
    expect(second.searchParams.get("minSimilarity")).toBe("0.7");
  });

  test("encodes a brain id and slug into the page path", async () => {
    const page = {
      id: "pg_1",
      slug: "topic/a b",
      title: "T",
      summary: "S",
      body: "B",
      pageType: "topic",
      status: "active",
      version: 3,
    };
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(page));
    const result = await createClient({ ...base, fetch: fetchImpl }).getPage("brn_1", "topic/a b");
    expect(result.version).toBe(3);
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/pages/topic%2Fa%20b");
  });

  test("maps a 404 envelope to an ApiError with the API message and status", async () => {
    const { fetchImpl } = recordingFetch(
      jsonResponse(errorEnvelope(404, "Not found", "NotFoundError"), 404, {
        "x-request-id": "req_1",
      }),
    );
    const client = createClient({ ...base, fetch: fetchImpl });
    const error = await client.getPage("brn_1", "missing").catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Not found",
      code: "NotFoundError",
      requestId: "req_1",
    });
  });

  test("maps a 429 envelope and keeps Retry-After", async () => {
    const { fetchImpl } = recordingFetch(
      jsonResponse(errorEnvelope(429, "Rate limit exceeded", "RateLimitError"), 429, {
        "retry-after": "30",
      }),
    );
    const client = createClient({ ...base, fetch: fetchImpl });
    const error = await client.search("brn_1", { q: "x" }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 429,
      message: "Rate limit exceeded",
      retryAfterSeconds: 30,
    });
  });

  test("falls back to a safe message for a non-JSON error body", async () => {
    const { fetchImpl } = recordingFetch(new Response("<html>gateway</html>", { status: 502 }));
    const client = createClient({ ...base, fetch: fetchImpl });
    const error = await client.listBrains().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 502, message: "The API returned an error." });
  });

  test("rejects a response that does not match the contract", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse({ items: "nope" }));
    const client = createClient({ ...base, fetch: fetchImpl });
    const error = await client.listBrains().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0 });
    expect((error as Error).message).toMatch(/unexpected response shape/);
  });

  test("reports an unreachable API without leaking the key", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("connect ECONNREFUSED");
    };
    const client = createClient({ ...base, fetch: fetchImpl });
    const error = await client.listBrains().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0 });
    expect((error as Error).message).not.toContain("mtv_live_secret");
  });

  test("posts a capture as JSON and accepts the created source", async () => {
    const source = {
      id: "src_1",
      brainId: "brn_1",
      status: "pending",
      attempts: 0,
      lastError: null,
      affectedPageIds: [],
    };
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(source, 201));
    const result = await createClient({ ...base, fetch: fetchImpl }).createCapture("brn_1", {
      kind: "note",
      content: "## Claim\n\nC",
      label: "search",
      originRef: "mcp:abc",
    });

    expect(result.id).toBe("src_1");
    expect(result.status).toBe("pending");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/captures");
    const init = recorded[0]?.init;
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-api-key"]).toBe("mtv_live_secret");
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "note",
      content: "## Claim\n\nC",
      label: "search",
      originRef: "mcp:abc",
    });
  });

  test("omits absent optional capture fields from the body", async () => {
    const source = {
      id: "src_1",
      brainId: "brn_1",
      status: "pending",
      attempts: 0,
      lastError: null,
      affectedPageIds: [],
    };
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(source, 201));
    await createClient({ ...base, fetch: fetchImpl }).createCapture("brn_1", {
      kind: "note",
      content: "note",
    });

    expect(JSON.parse(String(recorded[0]?.init.body))).toEqual({
      kind: "note",
      content: "note",
    });
  });

  test("reads one source by id", async () => {
    const source = {
      id: "src_1",
      brainId: "brn_1",
      status: "failed",
      attempts: 3,
      lastError: "prompt too long",
      affectedPageIds: [],
    };
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(source));
    const result = await createClient({ ...base, fetch: fetchImpl }).getSource("brn_1", "src_1");

    expect(result).toMatchObject({ status: "failed", attempts: 3, lastError: "prompt too long" });
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/sources/src_1");
    expect(recorded[0]?.init.method).toBe("GET");
  });
});
