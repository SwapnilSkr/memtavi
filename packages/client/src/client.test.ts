import { describe, expect, test } from "bun:test";
import { createClient, type FetchLike } from "./client";

interface Recorded {
  url: string;
  init: RequestInit;
}

const EPOCH = "2026-01-01T00:00:00.000Z";

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

const brain = {
  id: "brn_1",
  subjectId: "sub_1",
  projectId: null,
  name: "B",
  slug: "b",
  description: "",
  briefSettings: {},
  deletionState: "active",
  createdAt: EPOCH,
  updatedAt: EPOCH,
};

const page = {
  id: "pg_1",
  subjectId: "sub_1",
  brainId: "brn_1",
  slug: "topic",
  title: "T",
  summary: "S",
  body: "B",
  pageType: "topic",
  bucket: "inbox",
  bucketSource: "auto",
  status: "active",
  pinned: false,
  archived: false,
  version: 3,
  entities: [],
  backlinks: [],
  contentHash: "hash",
  embeddingModel: null,
  lastCompiledAt: null,
  lastReferencedAt: null,
  userEditedAt: null,
  deletionState: "active",
};

const source = {
  id: "src_1",
  brainId: "brn_1",
  kind: "note",
  contentPreview: "C",
  contentUrl: null,
  contentHash: "hash",
  originRef: null,
  label: null,
  bucket: "inbox",
  metadata: {},
  status: "pending",
  attempts: 0,
  lastError: null,
  affectedPageIds: [],
  originalBytes: 1,
  createdAt: EPOCH,
  compiledAt: null,
  deletedAt: null,
};

const connection = {
  id: "cnn_1",
  brainId: "brn_1",
  pageAId: "pg_1",
  pageBId: "pg_2",
  similarity: 0.7,
  strength: "medium",
  reasoning: "related",
  source: "auto",
  ackedAt: null,
};

const change = {
  id: "chg_1",
  brainId: "brn_1",
  pageId: "pg_1",
  action: "created",
  changeSummary: "Created",
  fromVersion: null,
  toVersion: 1,
  ingestSourceId: null,
  contradictions: [],
  ackedAt: null,
  createdAt: EPOCH,
};

const profile = {
  brainId: "brn_1",
  whoTheyAre: "",
  whatTheyDo: "",
  focus: "",
  goals: "",
  currentProjects: "",
  stuckOn: "",
  vaultOrganization: "",
  directives: {},
};

const score = {
  brainId: "brn_1",
  computedAt: EPOCH,
  freshness: 0.5,
  readiness: 0.6,
  strain: 0.2,
  factors: {},
};

const graph = {
  nodes: [
    {
      id: "pg_1",
      slug: "topic",
      title: "T",
      pageType: "topic",
      bucket: "inbox",
      status: "active",
      pinned: false,
    },
  ],
  edges: [
    {
      connectionId: "cnn_1",
      pageAId: "pg_1",
      pageBId: "pg_2",
      similarity: 0.7,
      strength: "medium",
      source: "auto",
    },
  ],
};

describe("createClient", () => {
  test("injects both auth headers and accepts the response", async () => {
    const { fetchImpl, recorded } = recordingFetch(
      jsonResponse({ items: [brain], total: 1, limit: 50, offset: 0 }),
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
    const { fetchImpl, recorded } = recordingFetch(jsonResponse({ ...page, slug: "topic/a b" }));
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
});

describe("brains", () => {
  test("creates a brain with POST and sends only the supplied fields", async () => {
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(brain, 201));
    const result = await createClient({ ...base, fetch: fetchImpl }).createBrain({
      name: "Work",
      slug: "work",
    });

    expect(result.id).toBe("brn_1");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains");
    expect(recorded[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(recorded[0]?.init.body))).toEqual({ name: "Work", slug: "work" });
  });

  test("reads one brain by id", async () => {
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(brain));
    const result = await createClient({ ...base, fetch: fetchImpl }).getBrain("brn_1");
    expect(result.slug).toBe("b");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1");
    expect(recorded[0]?.init.method).toBe("GET");
  });
});

describe("captures and sources", () => {
  test("posts a note capture as JSON and accepts the created source", async () => {
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

  test("posts a url capture with fetchUrl instead of content", async () => {
    const { fetchImpl, recorded } = recordingFetch(jsonResponse({ ...source, kind: "url" }, 201));
    await createClient({ ...base, fetch: fetchImpl }).createCapture("brn_1", {
      kind: "url",
      fetchUrl: "https://example.com/article",
      label: "reading",
    });

    expect(JSON.parse(String(recorded[0]?.init.body))).toEqual({
      kind: "url",
      fetchUrl: "https://example.com/article",
      label: "reading",
    });
  });

  test("omits absent optional capture fields from the body", async () => {
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
    const { fetchImpl, recorded } = recordingFetch(
      jsonResponse({ ...source, status: "failed", attempts: 3, lastError: "prompt too long" }),
    );
    const result = await createClient({ ...base, fetch: fetchImpl }).getSource("brn_1", "src_1");

    expect(result).toMatchObject({ status: "failed", attempts: 3, lastError: "prompt too long" });
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/sources/src_1");
    expect(recorded[0]?.init.method).toBe("GET");
  });
});

describe("pages", () => {
  test("lists pages with limit and offset", async () => {
    const { fetchImpl, recorded } = recordingFetch(
      jsonResponse({ items: [page], total: 1, limit: 10, offset: 5 }),
    );
    const result = await createClient({ ...base, fetch: fetchImpl }).listPages("brn_1", {
      limit: 10,
      offset: 5,
    });

    expect(result.items[0]?.slug).toBe("topic");
    expect(recorded[0]?.url).toBe(
      "https://api.example.com/v1/brains/brn_1/pages?limit=10&offset=5",
    );
  });

  test("updates a page with PATCH and sends only the supplied fields", async () => {
    const { fetchImpl, recorded } = recordingFetch(jsonResponse({ ...page, title: "New" }));
    const result = await createClient({ ...base, fetch: fetchImpl }).updatePage("brn_1", "topic", {
      title: "New",
      version: 3,
    });

    expect(result.title).toBe("New");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/pages/topic");
    expect(recorded[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(recorded[0]?.init.body))).toEqual({ title: "New", version: 3 });
  });

  test("deletes a page with permanent=true as a required query", async () => {
    const receipt = { id: "pg_1", targetType: "page", state: "deleted" };
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(receipt, 202));
    const result = await createClient({ ...base, fetch: fetchImpl }).deletePage("brn_1", "topic", {
      permanent: true,
    });

    expect(result.state).toBe("deleted");
    expect(recorded[0]?.url).toBe(
      "https://api.example.com/v1/brains/brn_1/pages/topic?permanent=true",
    );
    expect(recorded[0]?.init.method).toBe("DELETE");
    expect(recorded[0]?.init.body).toBeUndefined();
  });
});

describe("graph, changes, score and profile", () => {
  test("reads the graph", async () => {
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(graph));
    const result = await createClient({ ...base, fetch: fetchImpl }).getGraph("brn_1");
    expect(result.nodes).toHaveLength(1);
    expect(result.edges[0]?.connectionId).toBe("cnn_1");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/graph");
  });

  test("lists connections and acknowledges one", async () => {
    const listed = recordingFetch(
      jsonResponse({ items: [connection], total: 1, limit: 50, offset: 0 }),
    );
    const found = await createClient({ ...base, fetch: listed.fetchImpl }).listConnections("brn_1");
    expect(found.items[0]?.id).toBe("cnn_1");
    expect(listed.recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/connections");

    const ack = recordingFetch(jsonResponse({ ...connection, ackedAt: EPOCH }));
    await createClient({ ...base, fetch: ack.fetchImpl }).ackConnection("brn_1", "cnn_1");
    expect(ack.recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/connections/cnn_1");
    expect(ack.recorded[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(ack.recorded[0]?.init.body))).toEqual({ acked: true });
  });

  test("lists changes and acknowledges one", async () => {
    const listed = recordingFetch(
      jsonResponse({ items: [change], total: 1, limit: 50, offset: 0 }),
    );
    const found = await createClient({ ...base, fetch: listed.fetchImpl }).listChanges("brn_1");
    expect(found.items[0]?.action).toBe("created");
    expect(listed.recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/changes");

    const ack = recordingFetch(jsonResponse({ ...change, ackedAt: EPOCH }));
    await createClient({ ...base, fetch: ack.fetchImpl }).ackChange("brn_1", "chg_1");
    expect(ack.recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/changes/chg_1");
    expect(JSON.parse(String(ack.recorded[0]?.init.body))).toEqual({ acked: true });
  });

  test("reads the score", async () => {
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(score));
    const result = await createClient({ ...base, fetch: fetchImpl }).getScore("brn_1");
    expect(result.readiness).toBe(0.6);
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/score");
  });

  test("reads and updates the profile", async () => {
    const read = recordingFetch(jsonResponse(profile));
    const found = await createClient({ ...base, fetch: read.fetchImpl }).getProfile("brn_1");
    expect(found.brainId).toBe("brn_1");
    expect(read.recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/profile");

    const updated = recordingFetch(jsonResponse({ ...profile, focus: "search" }));
    const result = await createClient({ ...base, fetch: updated.fetchImpl }).updateProfile(
      "brn_1",
      { focus: "search", directives: { tone: "plain" } },
    );
    expect(result.focus).toBe("search");
    expect(updated.recorded[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(updated.recorded[0]?.init.body))).toEqual({
      focus: "search",
      directives: { tone: "plain" },
    });
  });

  test("exports the brain as a bundle", async () => {
    const bundle = {
      brain,
      pages: [page],
      versions: [
        {
          id: "ver_1",
          pageId: "pg_1",
          version: 3,
          title: "T",
          summary: "S",
          body: "B",
          ingestSourceId: null,
          actor: "compiler",
          createdAt: EPOCH,
        },
      ],
      sources: [source],
      connections: [connection],
    };
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(bundle));
    const result = await createClient({ ...base, fetch: fetchImpl }).exportBrain("brn_1");
    expect(result.pages).toHaveLength(1);
    expect(result.versions[0]?.actor).toBe("compiler");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/brains/brn_1/export");
  });
});

describe("webhooks", () => {
  const webhook = {
    id: "whk_1",
    subjectId: "sub_1",
    url: "https://example.com/hooks",
    events: ["created", "updated"],
    active: true,
  };
  const createdWebhook = { ...webhook, secret: "whsec_abc" };

  test("lists webhooks with limit and offset", async () => {
    const { fetchImpl, recorded } = recordingFetch(
      jsonResponse({ items: [webhook], total: 1, limit: 10, offset: 5 }),
    );
    const result = await createClient({ ...base, fetch: fetchImpl }).listWebhooks({
      limit: 10,
      offset: 5,
    });

    expect(result.items[0]?.id).toBe("whk_1");
    expect(result.items[0]?.secret).toBeUndefined();
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/webhooks?limit=10&offset=5");
    expect(recorded[0]?.init.method).toBe("GET");
  });

  test("creates a webhook and accepts the one-time secret", async () => {
    const { fetchImpl, recorded } = recordingFetch(jsonResponse(createdWebhook, 201));
    const result = await createClient({ ...base, fetch: fetchImpl }).createWebhook({
      url: "https://example.com/hooks",
      events: ["created", "updated"],
    });

    expect(result.secret).toBe("whsec_abc");
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/webhooks");
    expect(recorded[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(recorded[0]?.init.body))).toEqual({
      url: "https://example.com/hooks",
      events: ["created", "updated"],
    });
  });

  test("creates a webhook with every PRD event name", async () => {
    const events = [
      "brain.page.updated",
      "brain.change.new",
      "brain.connection.new",
      "brain.import.progress",
    ] as const;
    const { fetchImpl, recorded } = recordingFetch(
      jsonResponse({ ...createdWebhook, events }, 201),
    );
    const result = await createClient({ ...base, fetch: fetchImpl }).createWebhook({
      url: "https://example.com/hooks",
      events: [...events],
    });
    expect(result.events).toEqual([...events]);
    expect(JSON.parse(String(recorded[0]?.init.body)).events).toEqual([...events]);
  });

  test("rejects a create response without a secret", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse(webhook, 201));
    const error = await createClient({ ...base, fetch: fetchImpl })
      .createWebhook({ url: "https://example.com/hooks", events: ["created"] })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0 });
    expect((error as Error).message).toMatch(/unexpected response shape/);
  });

  test("deletes a webhook by id with no body", async () => {
    const { fetchImpl, recorded } = recordingFetch(new Response(null, { status: 204 }));
    const result = await createClient({ ...base, fetch: fetchImpl }).deleteWebhook("whk_1");

    expect(result).toBeUndefined();
    expect(recorded[0]?.url).toBe("https://api.example.com/v1/webhooks/whk_1");
    expect(recorded[0]?.init.method).toBe("DELETE");
    expect(recorded[0]?.init.body).toBeUndefined();
  });
});
