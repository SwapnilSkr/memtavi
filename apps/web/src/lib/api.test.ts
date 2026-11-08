import { describe, expect, test } from "bun:test";
import {
  ApiError,
  type CaptureInput,
  createApi,
  type Fetcher,
  type PageUpdate,
  type ProfileUpdate,
} from "./api";

const session = {
  baseUrl: "",
  apiKey: "test-key",
  subjectId: "00000000-0000-4000-8000-000000000001",
};

describe("API client", () => {
  test.each(["getGraph", "getScore", "getProfile"] as const)(
    "%s reads its encoded brain path",
    async (method) => {
      const resource = { getGraph: "graph", getScore: "score", getProfile: "profile" }[method];
      const fetcher = (async (input, init) => {
        expect(input).toBe(`/v1/brains/brn%2Fa/${resource}`);
        expect(init.method).toBe("GET");
        expect(init.body).toBeUndefined();
        const headers = new Headers(init.headers);
        expect(headers.has("Content-Type")).toBe(false);
        expect(headers.get("x-api-key")).toBe(session.apiKey);
        expect(headers.get("x-subject-id")).toBe(session.subjectId);
        return Response.json({});
      }) satisfies Fetcher;
      await createApi(session, fetcher)[method]("brn/a");
    },
  );

  test.each<ProfileUpdate>([
    { focus: "One priority" },
    {
      whoTheyAre: "",
      whatTheyDo: "Research",
      focus: "",
      goals: "Ship",
      currentProjects: "Inspector",
      stuckOn: "",
      vaultOrganization: "Topics",
      directives: { nested: { style: "brief" } },
    },
  ])("profile updates PATCH only the supplied JSON fields: %j", async (body) => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains/brn%2Fa/profile");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual(body);
      const headers = new Headers(init.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("x-api-key")).toBe(session.apiKey);
      expect(headers.get("x-subject-id")).toBe(session.subjectId);
      return Response.json({ brainId: "brn/a", ...body });
    }) satisfies Fetcher;
    expect((await createApi(session, fetcher).updateProfile("brn/a", body)).brainId).toBe("brn/a");
  });

  test("a missing score retains its 404 status for the screen empty state", async () => {
    const fetcher = (async () =>
      Response.json(
        { body: { message: "Not found", error: "NotFoundError", statusCode: 404 } },
        { status: 404 },
      )) satisfies Fetcher;
    await expect(createApi(session, fetcher).getScore("brn_test")).rejects.toMatchObject({
      status: 404,
      kind: "permanent",
    });
  });

  test("profile PATCH errors retain their safe message", async () => {
    const fetcher = (async () =>
      Response.json({ message: "Invalid directives" }, { status: 400 })) satisfies Fetcher;
    await expect(
      createApi(session, fetcher).updateProfile("brn_test", { directives: {} }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid directives" });
  });

  test("adds both session headers to reads without a JSON body", async () => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains?limit=50&offset=0");
      expect(init.method).toBe("GET");
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
    { status: 409, code: "ConflictError", kind: "permanent" },
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

  test.each<CaptureInput>([
    { kind: "note", content: "A note", label: "Research", originRef: "note-1" },
    { kind: "url", fetchUrl: "https://example.test/article" },
  ])("capture sends $kind JSON and session headers with POST", async (body) => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains/brn%2Fa/captures");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual(body);
      const headers = new Headers(init.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("x-api-key")).toBe(session.apiKey);
      expect(headers.get("x-subject-id")).toBe(session.subjectId);
      return Response.json({ id: "src_test", status: "pending" }, { status: 201 });
    }) satisfies Fetcher;
    expect((await createApi(session, fetcher).capture("brn/a", body)).status).toBe("pending");
  });

  test("source polling reads an encoded source path without a body", async () => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains/brn%2Fa/sources/src%2Fb");
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      expect(new Headers(init.headers).has("Content-Type")).toBe(false);
      return Response.json({ id: "src/b", status: "compiling" });
    }) satisfies Fetcher;
    expect((await createApi(session, fetcher).getSource("brn/a", "src/b")).status).toBe(
      "compiling",
    );
  });

  test.each<PageUpdate>([
    { title: "Updated", body: "# Markdown", version: 3 },
    { status: "active", version: 4 },
  ])("page changes and resolution use PATCH with version: %j", async (body) => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains/brn%2Fa/pages/a%2Fb%20%3F%23");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual(body);
      const headers = new Headers(init.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("x-api-key")).toBe(session.apiKey);
      expect(headers.get("x-subject-id")).toBe(session.subjectId);
      return Response.json({ title: "Updated", version: body.version + 1 });
    }) satisfies Fetcher;
    expect((await createApi(session, fetcher).updatePage("brn/a", "a/b ?#", body)).version).toBe(
      body.version + 1,
    );
  });

  test("a stale page PATCH preserves the conflict status for reload handling", async () => {
    const fetcher = (async () =>
      Response.json(
        { body: { message: "Version conflict", error: "ConflictError", statusCode: 409 } },
        { status: 409 },
      )) satisfies Fetcher;
    await expect(
      createApi(session, fetcher).updatePage("brn_test", "page", { summary: "Edit", version: 1 }),
    ).rejects.toMatchObject({ status: 409, code: "ConflictError", kind: "permanent" });
  });

  test("export reads the encoded brain export path without a body", async () => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains/brn%2Fa/export");
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      const headers = new Headers(init.headers);
      expect(headers.has("Content-Type")).toBe(false);
      expect(headers.get("x-api-key")).toBe(session.apiKey);
      expect(headers.get("x-subject-id")).toBe(session.subjectId);
      return Response.json({ brain: {}, pages: [], versions: [], sources: [], connections: [] });
    }) satisfies Fetcher;
    const bundle = await createApi(session, fetcher).exportBrain("brn/a");
    expect(bundle.pages).toEqual([]);
    expect(bundle.connections).toEqual([]);
  });

  test("permanent delete sends DELETE with permanent=true and no body", async () => {
    const fetcher = (async (input, init) => {
      expect(input).toBe("/v1/brains/brn%2Fa/pages/a%2Fb%20%3F%23?permanent=true");
      expect(init.method).toBe("DELETE");
      expect(init.body).toBeUndefined();
      expect(new Headers(init.headers).has("Content-Type")).toBe(false);
      return Response.json(
        { id: "pg_test", targetType: "page", state: "deleted" },
        { status: 202 },
      );
    }) satisfies Fetcher;
    expect(await createApi(session, fetcher).deletePage("brn/a", "a/b ?#")).toEqual({
      id: "pg_test",
      targetType: "page",
      state: "deleted",
    });
  });

  test("a rejected permanent delete keeps the API message and status", async () => {
    const fetcher = (async () =>
      Response.json(
        { body: { message: "Not found", error: "NotFoundError", statusCode: 404 } },
        { status: 404 },
      )) satisfies Fetcher;
    await expect(createApi(session, fetcher).deletePage("brn_test", "gone")).rejects.toMatchObject({
      status: 404,
      code: "NotFoundError",
      message: "Not found",
      kind: "permanent",
    });
  });
});
