import { describe, expect, test } from "bun:test";
import { MemtaviApi, MemtaviApiClient, MemtaviApiError } from "../dist/index.js";

const API_KEY = "test-key";
const SUBJECT_ID = "3f2f6f1a-9d4b-4c1e-8f5a-2b7c9d0e1f23";
const BASE_URL = "https://api.test";
const BRAIN_ID = "brn_0123456789abcdef0123456789abcdef";

interface CapturedRequest {
  method: string;
  path: string;
  apiKey: string | null;
  subjectId: string | null;
}

function stubClient(response: Response, captured: CapturedRequest[]): MemtaviApiClient {
  const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    captured.push({
      method: request.method,
      path: new URL(request.url).pathname,
      apiKey: request.headers.get("x-api-key"),
      subjectId: request.headers.get("x-subject-id"),
    });
    return response;
  };
  return new MemtaviApiClient({
    apiKey: API_KEY,
    subjectId: SUBJECT_ID,
    baseUrl: BASE_URL,
    maxRetries: 0,
    fetch: fetchStub as typeof fetch,
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorEnvelope(statusCode: number, error: string) {
  return {
    statusCode,
    timestamp: "2026-11-06T10:00:00.000Z",
    path: "/v1/brains",
    message: "Not found",
    body: { message: "Not found", error, statusCode },
  };
}

describe("memtavi typescript sdk", () => {
  test("listBrains sends GET /v1/brains with both auth headers", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(
      jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }, 200),
      captured,
    );

    const page = await client.brains.listBrains();

    expect(page).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      method: "GET",
      path: "/v1/brains",
      apiKey: API_KEY,
      subjectId: SUBJECT_ID,
    });
  });

  test("a 404 the operation does not declare surfaces as the base error", async () => {
    const client = stubClient(jsonResponse(errorEnvelope(404, "NotFoundError"), 404), []);

    const error = await client.brains.listBrains().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MemtaviApiError);
    expect((error as MemtaviApiError).statusCode).toBe(404);
  });

  test("a declared 404 envelope surfaces as NotFoundError", async () => {
    const client = stubClient(jsonResponse(errorEnvelope(404, "NotFoundError"), 404), []);

    const error = await client.brains
      .getBrain({ brainId: BRAIN_ID })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MemtaviApi.NotFoundError);
    expect((error as MemtaviApi.NotFoundError).body.body.error).toBe("NotFoundError");
  });

  test.each([
    [502, "UpstreamError", MemtaviApi.BadGatewayError],
    [503, "ServiceUnavailableError", MemtaviApi.ServiceUnavailableError],
  ] as const)(
    "suggestProfile exposes %s (%s) as a declared SDK error",
    async (status, code, errorType) => {
      const captured: CapturedRequest[] = [];
      const body = {
        statusCode: status,
        timestamp: "2026-11-06T10:00:00.000Z",
        path: `/v1/brains/${BRAIN_ID}/profile/suggestions`,
        message: "Profile suggestions unavailable",
        body: { message: "Profile suggestions unavailable", error: code, statusCode: status },
      };
      const client = stubClient(jsonResponse(body, status), captured);
      const error = await client.profile
        .suggestProfile({ brainId: BRAIN_ID })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(errorType);
      expect(error).toMatchObject({ statusCode: status, body });
      expect(captured).toHaveLength(1);
    },
  );

  test("suggestProfile sends POST with both auth headers and preserves suggestion metadata", async () => {
    const captured: CapturedRequest[] = [];
    const body = {
      generatedBy: "model",
      model: "pinned-chat-v1",
      promptHash: "a".repeat(64),
      items: [
        {
          field: "focus",
          value: "Ship the API",
          confidence: 0.8,
          evidence: [{ slug: "api", title: "API" }],
        },
      ],
    };
    const client = stubClient(jsonResponse(body, 200), captured);
    expect(await client.profile.suggestProfile({ brainId: BRAIN_ID })).toEqual(body);
    expect(captured).toEqual([
      {
        method: "POST",
        path: `/v1/brains/${BRAIN_ID}/profile/suggestions`,
        apiKey: API_KEY,
        subjectId: SUBJECT_ID,
      },
    ]);
  });
});

test("review operations serialize filters, both placement choices and dismissal", async () => {
  const reviewId = "11111111-1111-4111-8111-111111111111";
  const pageId = `pg_${"1".repeat(32)}`;
  const basePath = `/v1/brains/${BRAIN_ID}/routing-reviews`;
  const captured: { method: string; path: string; query: string; body: unknown }[] = [];
  const review = {
    id: reviewId,
    sourceId: `src_${"1".repeat(32)}`,
    fact: {
      claim: "Friday",
      entities: [],
      evidence: { chunkUuid: reviewId, charStart: 0, charEnd: 6, quote: "Friday" },
    },
    candidates: [],
    bestGap: 0,
    status: "resolved",
    resolution: null,
    createdAt: "2026-11-11T00:00:00.000Z",
  };
  const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = await request.text();
    expect(request.headers.get("x-api-key")).toBe(API_KEY);
    expect(request.headers.get("x-subject-id")).toBe(SUBJECT_ID);
    captured.push({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body: body ? JSON.parse(body) : null,
    });
    return request.method === "GET"
      ? jsonResponse({ items: [review], total: 1, limit: 5, offset: 2 }, 200)
      : jsonResponse(review, url.pathname.endsWith("resolve") ? 202 : 200);
  };
  const client = new MemtaviApiClient({
    apiKey: API_KEY,
    subjectId: SUBJECT_ID,
    baseUrl: BASE_URL,
    maxRetries: 0,
    fetch: fetchStub as typeof fetch,
  });
  expect(
    (
      await client.reviews.listRoutingReviews({
        brainId: BRAIN_ID,
        status: "resolved",
        limit: 5,
        offset: 2,
      })
    ).total,
  ).toBe(1);
  await client.reviews.resolveRoutingReview({
    brainId: BRAIN_ID,
    reviewId,
    body: { pageId, note: "Chosen" },
  });
  await client.reviews.resolveRoutingReview({
    brainId: BRAIN_ID,
    reviewId,
    body: { newPage: true },
  });
  await client.reviews.dismissRoutingReview({ brainId: BRAIN_ID, reviewId, note: "Source only" });
  expect(captured).toEqual([
    { method: "GET", path: basePath, query: "?limit=5&offset=2&status=resolved", body: null },
    {
      method: "POST",
      path: `${basePath}/${reviewId}/resolve`,
      query: "",
      body: { pageId, note: "Chosen" },
    },
    { method: "POST", path: `${basePath}/${reviewId}/resolve`, query: "", body: { newPage: true } },
    {
      method: "POST",
      path: `${basePath}/${reviewId}/dismiss`,
      query: "",
      body: { note: "Source only" },
    },
  ]);
});
