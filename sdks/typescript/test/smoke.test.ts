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
});
