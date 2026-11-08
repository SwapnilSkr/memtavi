import { describe, expect, test } from "bun:test";
import { ApiError } from "./client";
import { createFakeClient } from "./fake-client";
import { createTools, type ToolResult } from "./tools";

function textOf(result: ToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

function parse(result: ToolResult): unknown {
  return JSON.parse(textOf(result));
}

const page = {
  id: "pg_1",
  slug: "vector-search",
  title: "Vector search",
  summary: "How search works",
  body: "# Vector search\n\nBody text.",
  pageType: "topic",
  status: "active",
  version: 4,
};

describe("list_brains", () => {
  test("returns id, name and slug only", async () => {
    const client = createFakeClient({
      brains: [
        { id: "brn_1", name: "Work", slug: "work" },
        { id: "brn_2", name: "Home", slug: "home" },
      ],
    });
    const tools = createTools(client, { brainId: undefined });
    const result = await tools.listBrains();

    expect(result.isError).toBeUndefined();
    expect(parse(result)).toEqual({
      brains: [
        { id: "brn_1", name: "Work", slug: "work" },
        { id: "brn_2", name: "Home", slug: "home" },
      ],
      total: 2,
    });
  });

  test("returns isError with the API message on failure", async () => {
    const client = createFakeClient({
      failures: { listBrains: new ApiError(401, "Invalid API key", { code: "Unauthorized" }) },
    });
    const result = await createTools(client, { brainId: undefined }).listBrains();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("HTTP 401: Invalid API key");
  });
});

describe("index", () => {
  const entries = [
    {
      slug: "vector-search",
      title: "Vector search",
      summary: "How search works",
      pageType: "topic",
      pinned: false,
    },
    {
      slug: "rls",
      title: "Row level security",
      summary: "Tenancy",
      pageType: "topic",
      pinned: true,
    },
  ];

  test("defaults the limit to 40 and returns compact entries", async () => {
    const client = createFakeClient({ index: entries });
    const result = await createTools(client, { brainId: "brn_1" }).index({});
    const body = parse(result) as { entries: unknown[]; brainId: string; limit: number };

    expect(client.calls[0]).toEqual({ method: "getIndex", args: ["brn_1", 40] });
    expect(body.brainId).toBe("brn_1");
    expect(body.limit).toBe(40);
    expect(body.entries).toEqual([
      {
        slug: "vector-search",
        title: "Vector search",
        summary: "How search works",
        pageType: "topic",
        pinned: false,
      },
      {
        slug: "rls",
        title: "Row level security",
        summary: "Tenancy",
        pageType: "topic",
        pinned: true,
      },
    ]);
  });

  test("passes an explicit limit through", async () => {
    const client = createFakeClient({ index: entries });
    await createTools(client, { brainId: "brn_1" }).index({ limit: 5 });
    expect(client.calls[0]?.args).toEqual(["brn_1", 5]);
  });

  test("maps a 404 to isError without a stack", async () => {
    const client = createFakeClient({
      failures: { getIndex: new ApiError(404, "Not found", { code: "NotFoundError" }) },
    });
    const result = await createTools(client, { brainId: "brn_1" }).index({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("HTTP 404: Not found");
  });

  test("maps a 429 to isError with the status", async () => {
    const client = createFakeClient({
      failures: {
        getIndex: new ApiError(429, "Rate limit exceeded", { retryAfterSeconds: 12 }),
      },
    });
    const result = await createTools(client, { brainId: "brn_1" }).index({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("HTTP 429: Rate limit exceeded");
  });
});

describe("search", () => {
  const hits = [
    {
      pageId: "pg_1",
      slug: "vector-search",
      title: "Vector search",
      summary: "How search works",
      similarity: 0.82,
    },
    {
      pageId: "pg_2",
      slug: "fts",
      title: "Full text search",
      summary: "Keyword search",
      similarity: null,
    },
  ];

  test("defaults the limit to 10 and returns slug, title, summary and similarity", async () => {
    const client = createFakeClient({ hits });
    const result = await createTools(client, { brainId: "brn_1" }).search({ q: "search" });
    const body = parse(result) as { hits: unknown[]; q: string };

    expect(client.calls[0]).toEqual({
      method: "search",
      args: ["brn_1", { q: "search", limit: 10 }],
    });
    expect(body.q).toBe("search");
    expect(body.hits).toEqual([
      {
        slug: "vector-search",
        title: "Vector search",
        summary: "How search works",
        similarity: 0.82,
      },
      { slug: "fts", title: "Full text search", summary: "Keyword search", similarity: null },
    ]);
  });

  test("forwards minSimilarity and a custom limit", async () => {
    const client = createFakeClient({ hits });
    await createTools(client, { brainId: "brn_1" }).search({
      q: "search",
      limit: 3,
      minSimilarity: 0.5,
    });
    expect(client.calls[0]?.args).toEqual(["brn_1", { q: "search", limit: 3, minSimilarity: 0.5 }]);
  });

  test("maps a 422 to isError", async () => {
    const client = createFakeClient({
      failures: { search: new ApiError(422, "q must not be empty") },
    });
    const result = await createTools(client, { brainId: "brn_1" }).search({ q: "x" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("HTTP 422: q must not be empty");
  });
});

describe("read", () => {
  test("returns title, summary, version, status and the markdown body", async () => {
    const client = createFakeClient({ pages: { "vector-search": page } });
    const result = await createTools(client, { brainId: "brn_1" }).read({ slug: "vector-search" });

    expect(client.calls[0]).toEqual({ method: "getPage", args: ["brn_1", "vector-search"] });
    expect(parse(result)).toEqual({
      slug: "vector-search",
      title: "Vector search",
      summary: "How search works",
      version: 4,
      status: "active",
      body: "# Vector search\n\nBody text.",
    });
  });

  test("maps a missing slug to a 404 isError", async () => {
    const client = createFakeClient({ pages: {} });
    const result = await createTools(client, { brainId: "brn_1" }).read({ slug: "missing" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("HTTP 404: Not found");
  });
});

describe("brain resolution", () => {
  test("prefers an explicit brainId argument over the env value", async () => {
    const client = createFakeClient({
      brains: [{ id: "brn_env", name: "Env", slug: "env" }],
      index: [],
    });
    await createTools(client, { brainId: "brn_env" }).index({ brainId: "brn_arg" });
    expect(client.calls[0]?.args).toEqual(["brn_arg", 40]);
  });

  test("uses MEMTAVI_BRAIN_ID when no argument is given", async () => {
    const client = createFakeClient({ index: [] });
    await createTools(client, { brainId: "brn_env" }).index({});
    expect(client.calls[0]?.args).toEqual(["brn_env", 40]);
    expect(client.calls.some((call) => call.method === "listBrains")).toBe(false);
  });

  test("falls back to the only available brain", async () => {
    const client = createFakeClient({
      brains: [{ id: "brn_only", name: "Only", slug: "only" }],
      index: [],
    });
    await createTools(client, { brainId: undefined }).index({});
    expect(client.calls.map((call) => call.method)).toEqual(["listBrains", "getIndex"]);
    expect(client.calls[1]?.args).toEqual(["brn_only", 40]);
  });

  test("refuses to guess between multiple brains and lists them", async () => {
    const client = createFakeClient({
      brains: [
        { id: "brn_1", name: "Work", slug: "work" },
        { id: "brn_2", name: "Home", slug: "home" },
      ],
    });
    const result = await createTools(client, { brainId: undefined }).index({});

    expect(result.isError).toBe(true);
    const message = textOf(result);
    expect(message).toContain("brainId is required");
    expect(message).toContain("brn_1");
    expect(message).toContain("brn_2");
    expect(message).toContain("MEMTAVI_BRAIN_ID");
    expect(client.calls.map((call) => call.method)).toEqual(["listBrains"]);
  });

  test("explains an empty brain list", async () => {
    const client = createFakeClient({ brains: [] });
    const result = await createTools(client, { brainId: undefined }).index({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No brains are visible");
  });

  test("reports a failure while listing brains for resolution", async () => {
    const client = createFakeClient({
      failures: { listBrains: new ApiError(401, "Missing API key") },
    });
    const result = await createTools(client, { brainId: undefined }).index({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("HTTP 401: Missing API key");
  });
});

describe("error hygiene", () => {
  test("never includes a stack trace in an error result", async () => {
    const client = createFakeClient({
      failures: { getIndex: new ApiError(500, "Internal error") },
    });
    const result = await createTools(client, { brainId: "brn_1" }).index({});
    const message = textOf(result);
    expect(message).not.toContain("at ");
    expect(message).not.toContain(".ts:");
  });

  test("returns a generic message for an unexpected thrown value", async () => {
    const client = createFakeClient({ failures: { getIndex: new Error("boom") } });
    const result = await createTools(client, { brainId: "brn_1" }).index({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("The tool failed unexpectedly.");
  });

  test("names a network failure without the key", async () => {
    const client = createFakeClient({
      failures: { getIndex: new ApiError(0, "Could not reach the Memtavi API.") },
    });
    const result = await createTools(client, { brainId: "brn_1" }).index({});
    expect(textOf(result)).toBe("network error: Could not reach the Memtavi API.");
  });
});
