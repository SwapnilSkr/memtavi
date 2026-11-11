import { expect, test } from "bun:test";
import { type Api, createApi } from "./api";

const session = { baseUrl: "", apiKey: "fixture-session-key", subjectId: "subject-fixture" };

const cases: {
  name: string;
  call: (api: Api) => Promise<unknown>;
  path: string;
  method: string;
  body?: unknown;
  status?: number;
  response?: unknown;
}[] = [
  {
    name: "30-day history default",
    call: (api) => api.getScoreHistory("brn/a"),
    path: "/brains/brn%2Fa/score/history?range=30d",
    method: "GET",
    response: { range: "30d", points: [], delta: null },
  },
  {
    name: "history range",
    call: (api) => api.getScoreHistory("brn/a", "7d"),
    path: "/brains/brn%2Fa/score/history?range=7d",
    method: "GET",
  },
  {
    name: "score suggestions",
    call: (api) => api.getScoreSuggestions("brn/a"),
    path: "/brains/brn%2Fa/score/suggestions",
    method: "POST",
  },
  {
    name: "paid profile suggestions",
    call: (api) => api.suggestProfile("brn/a"),
    path: "/brains/brn%2Fa/profile/suggestions",
    method: "POST",
    response: {
      generatedBy: "model",
      model: "fixture",
      promptHash: "a".repeat(64),
      items: [
        {
          field: "focus",
          value: "Research",
          confidence: 0.8,
          evidence: [{ slug: "topic", title: "Topic" }],
        },
      ],
    },
  },
  {
    name: "subject memory settings",
    call: (api) => api.getMemorySettings(),
    path: "/memory-settings",
    method: "GET",
    response: { mode: "auto", updatedAt: null },
  },
  {
    name: "memory mode update",
    call: (api) => api.updateMemorySettings({ mode: "ask" }),
    path: "/memory-settings",
    method: "PUT",
    body: { mode: "ask" },
    response: { mode: "ask", updatedAt: "2026-11-11T00:00:00Z" },
  },
  {
    name: "key list defaults",
    call: (api) => api.listApiKeys(),
    path: "/api-keys?limit=50&offset=0",
    method: "GET",
  },
  {
    name: "key list paging",
    call: (api) => api.listApiKeys({ limit: 10, offset: 250 }),
    path: "/api-keys?limit=10&offset=250",
    method: "GET",
  },
  {
    name: "key creation",
    call: (api) =>
      api.createApiKey({ name: "Deploy", role: "developer", scopes: ["read"], expiresAt: null }),
    path: "/api-keys",
    method: "POST",
    body: { name: "Deploy", role: "developer", scopes: ["read"], expiresAt: null },
    status: 201,
    response: { id: "key-fixture", key: "synthetic-created-key" },
  },
  {
    name: "key revocation without JSON",
    call: (api) => api.deleteApiKey("key/a ?#"),
    path: "/api-keys/key%2Fa%20%3F%23",
    method: "DELETE",
    status: 204,
  },
  {
    name: "webhook list defaults",
    call: (api) => api.listWebhooks(),
    path: "/webhooks?limit=50&offset=0",
    method: "GET",
  },
  {
    name: "webhook list paging",
    call: (api) => api.listWebhooks({ limit: 10, offset: 250 }),
    path: "/webhooks?limit=10&offset=250",
    method: "GET",
  },
  {
    name: "webhook creation",
    call: (api) =>
      api.createWebhook({
        url: "https://example.test/hook",
        events: ["brain.page.updated", "brain.connection.new"],
      }),
    path: "/webhooks",
    method: "POST",
    body: {
      url: "https://example.test/hook",
      events: ["brain.page.updated", "brain.connection.new"],
    },
    status: 201,
    response: { id: "hook-fixture", secret: "synthetic-signing-secret" },
  },
  {
    name: "webhook deletion without JSON",
    call: (api) => api.deleteWebhook("hook/a ?#"),
    path: "/webhooks/hook%2Fa%20%3F%23",
    method: "DELETE",
    status: 204,
  },
  {
    name: "member list defaults",
    call: (api) => api.listMembers(),
    path: "/members?limit=50&offset=0",
    method: "GET",
  },
  {
    name: "member list paging",
    call: (api) => api.listMembers({ limit: 10, offset: 250 }),
    path: "/members?limit=10&offset=250",
    method: "GET",
  },
  {
    name: "unfiltered paged index",
    call: (api) => api.getIndex("brn/a", { limit: 50, offset: 250 }),
    path: "/brains/brn%2Fa/index?limit=50&offset=250",
    method: "GET",
    response: {
      items: [{ slug: "disputed", status: "contested" }],
      total: 400,
      limit: 50,
      offset: 250,
    },
  },
  {
    name: "filtered paged index",
    call: (api) => api.getIndex("brn/a", { limit: 50, offset: 250, status: "contested" }),
    path: "/brains/brn%2Fa/index?limit=50&offset=250&status=contested",
    method: "GET",
  },
  {
    name: "default index paging",
    call: (api) => api.getIndex("brn/a"),
    path: "/brains/brn%2Fa/index?limit=40&offset=0",
    method: "GET",
  },
];

test.each(cases)(
  "$name follows the contract",
  async ({ call, path, method, body, status = 200, response = {} }) => {
    const api = createApi(session, async (input, init) => {
      expect(input).toBe(`/v1${path}`);
      expect(init.method).toBe(method);
      const headers = new Headers(init.headers);
      expect(headers.get("x-api-key")).toBe(session.apiKey);
      expect(headers.get("x-subject-id")).toBe(session.subjectId);
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      if (body === undefined) {
        expect(init.body).toBeUndefined();
        expect(headers.has("Content-Type")).toBe(false);
      } else {
        expect(JSON.parse(String(init.body))).toEqual(body);
        expect(headers.get("Content-Type")).toBe("application/json");
      }
      return status === 204 ? new Response(null, { status }) : Response.json(response, { status });
    });
    expect(await call(api)).toEqual(status === 204 ? undefined : response);
  },
);

test.each([429, 503, 502])(
  "profile suggestion errors preserve distinct status %s",
  async (status) => {
    const api = createApi(session, async () =>
      Response.json({ body: { error: "SuggestionError", message: "Safe error" } }, { status }),
    );
    await expect(api.suggestProfile("brn_a")).rejects.toMatchObject({
      status,
      code: "SuggestionError",
      message: "Safe error",
    });
  },
);

test("member denial preserves 403 for the admin-only state", async () => {
  const api = createApi(session, async () =>
    Response.json({ message: "Admin required" }, { status: 403 }),
  );
  await expect(api.listMembers()).rejects.toMatchObject({ status: 403 });
});
