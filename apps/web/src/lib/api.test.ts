import { describe, expect, test } from "bun:test";
import { ApiError, createApi, type Fetcher } from "./api";

const session = {
  baseUrl: "",
  apiKey: "test-key",
  subjectId: "00000000-0000-4000-8000-000000000001",
};

describe("API client", () => {
  test("adds both session headers to reads without a JSON body", async () => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains?limit=50&offset=0");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe(session.apiKey);
      expect(headers.get("x-subject-id")).toBe(session.subjectId);
      expect(headers.has("Content-Type")).toBe(false);
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
    }) satisfies Fetcher;
    expect((await createApi(session, fetcher).listBrains()).items).toEqual([]);
  });

  test("sends create JSON to the configured base URL with both headers", async () => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("https://api.example.test/prefix/v1/brains");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
      expect(new Headers(init?.headers).get("x-api-key")).toBe(session.apiKey);
      expect(new Headers(init?.headers).get("x-subject-id")).toBe(session.subjectId);
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Research" });
      return Response.json({ id: "brn_test", name: "Research" }, { status: 201 });
    }) satisfies Fetcher;
    expect(
      (
        await createApi(
          { ...session, baseUrl: "https://api.example.test/prefix///" },
          fetcher,
        ).createBrain({ name: "Research" })
      ).id,
    ).toBe("brn_test");
  });

  test.each([
    { status: 400, code: "BadRequestError", kind: "permanent" },
    { status: 401, code: "UnauthorizedError", kind: "permanent" },
    { status: 404, code: "NotFoundError", kind: "permanent" },
    { status: 429, code: "RateLimitError", kind: "transient" },
    { status: 500, code: "InternalServerError", kind: "transient" },
  ])("maps the error envelope for $status", async ({ status, code, kind }) => {
    const fetcher = (async () =>
      Response.json(
        {
          statusCode: status,
          timestamp: "2026-11-08T00:00:00Z",
          path: "/v1/brains",
          message: "Outer message",
          body: { message: "Client-safe API message", error: code, statusCode: status },
        },
        { status },
      )) satisfies Fetcher;
    try {
      await createApi(session, fetcher).listBrains();
      throw new Error("Expected API rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe("Client-safe API message");
      expect(error.kind).toBe(kind);
    }
  });

  test("accepts the top-level error message when body is missing", async () => {
    const fetcher = (async () =>
      Response.json({ message: "Invalid API key" }, { status: 401 })) satisfies Fetcher;
    await expect(createApi(session, fetcher).listBrains()).rejects.toMatchObject({
      status: 401,
      code: "HttpError",
      message: "Invalid API key",
    });
  });

  test("does not expose a non-JSON error body", async () => {
    const fetcher = (async () =>
      new Response("private upstream body", { status: 502 })) satisfies Fetcher;
    await expect(createApi(session, fetcher).listBrains()).rejects.toMatchObject({
      status: 502,
      message: "Request failed (502).",
      kind: "transient",
    });
  });

  test("classifies fetch failures without exposing their details", async () => {
    const fetcher = (async () => {
      throw new Error("private connection details");
    }) satisfies Fetcher;
    await expect(createApi(session, fetcher).listBrains()).rejects.toMatchObject({
      status: 0,
      code: "NetworkError",
      kind: "transient",
    });
  });

  test("reports malformed success JSON", async () => {
    const fetcher = (async () => new Response("not json")) satisfies Fetcher;
    await expect(createApi(session, fetcher).listBrains()).rejects.toMatchObject({
      code: "InvalidResponse",
      kind: "permanent",
    });
  });

  test("encodes identifiers, pagination and search without hydrating page lists", async () => {
    const paths: string[] = [];
    const fetcher = (async (input) => {
      paths.push(String(input));
      return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
    }) satisfies Fetcher;
    const api = createApi(session, fetcher);
    await api.listBrains({ limit: 20, offset: 40 });
    await api.getBrain("brn/a");
    await api.listPages("brn/a", { limit: 10, offset: 20 });
    await api.getPage("brn/a", "a/b ?#");
    await api.search("brn/a", { q: "hello & world", limit: 10, minSimilarity: 0 });
    expect(paths).toEqual([
      "/v1/brains?limit=20&offset=40",
      "/v1/brains/brn%2Fa",
      "/v1/brains/brn%2Fa/pages?limit=10&offset=20",
      "/v1/brains/brn%2Fa/pages/a%2Fb%20%3F%23",
      "/v1/brains/brn%2Fa/search?q=hello+%26+world&limit=10&minSimilarity=0",
    ]);
  });
});
