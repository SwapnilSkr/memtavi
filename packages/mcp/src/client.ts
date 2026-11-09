import { z } from "zod";

export interface BrainSummary {
  id: string;
  name: string;
  slug: string;
}

export interface IndexEntry {
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  pinned: boolean;
  updatedAt?: string | undefined;
}

export interface SearchHit {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  pageType?: string | undefined;
  similarity: number | null;
  updatedAt?: string | undefined;
}

export interface Page {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  pageType: string;
  status: string;
  version: number;
}

export interface PageList<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchQuery {
  q: string;
  limit?: number | undefined;
  minSimilarity?: number | undefined;
}

export interface IngestSource {
  id: string;
  brainId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  affectedPageIds: string[];
}

export interface CaptureRequest {
  kind: "note";
  content: string;
  label?: string | undefined;
  originRef?: string | undefined;
}

export interface ApiClient {
  listBrains(): Promise<PageList<BrainSummary>>;
  getIndex(brainId: string, limit?: number | undefined): Promise<PageList<IndexEntry>>;
  search(brainId: string, query: SearchQuery): Promise<PageList<SearchHit>>;
  getPage(brainId: string, slug: string): Promise<Page>;
  createCapture(brainId: string, body: CaptureRequest): Promise<IngestSource>;
  getSource(brainId: string, sourceId: string): Promise<IngestSource>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  apiUrl: string;
  apiKey: string;
  subjectId: string;
  fetch?: FetchLike;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    message: string,
    extra: {
      code?: string | undefined;
      requestId?: string | undefined;
      retryAfterSeconds?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = extra.code;
    this.requestId = extra.requestId;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

const brainSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

const indexEntrySchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  pageType: z.string(),
  pinned: z.boolean(),
  updatedAt: z.string().optional(),
});

const searchHitSchema = z.object({
  pageId: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  pageType: z.string().optional(),
  similarity: z.number().nullable(),
  updatedAt: z.string().optional(),
});

const pageSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  pageType: z.string(),
  status: z.string(),
  version: z.number(),
});

const sourceSchema = z.object({
  id: z.string(),
  brainId: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  affectedPageIds: z.array(z.string()),
});

const errorEnvelopeSchema = z.object({
  statusCode: z.number().optional(),
  message: z.string().optional(),
  body: z
    .object({
      message: z.string().optional(),
      error: z.string().optional(),
      statusCode: z.number().optional(),
    })
    .optional(),
});

function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  });
}

function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown, what: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(0, `The API returned an unexpected response shape for ${what}.`);
  }
  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorMessage(payload: unknown): { message: string; code: string | undefined } {
  const parsed = errorEnvelopeSchema.safeParse(payload);
  if (parsed.success) {
    const fromBody = parsed.data.body?.message;
    const fromTop = parsed.data.message;
    const code = parsed.data.body?.error;
    const message = fromBody ?? fromTop;
    if (message !== undefined && message !== "") {
      return { message, code };
    }
    return { message: code ?? "The API returned an error.", code };
  }
  return { message: "The API returned an error.", code: undefined };
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function joinUrl(base: string, path: string, query?: Record<string, string | undefined>): string {
  const url = `${base}${path}`;
  if (query === undefined) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  const search = params.toString();
  return search === "" ? url : `${url}?${search}`;
}

export function createClient(options: ClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.apiUrl.replace(/\/+$/, "");

  async function request(
    path: string,
    requestOptions: {
      query?: Record<string, string | undefined> | undefined;
      body?: unknown;
    } = {},
  ): Promise<unknown> {
    const url = joinUrl(base, path, requestOptions.query);
    const hasBody = requestOptions.body !== undefined;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: hasBody ? "POST" : "GET",
        headers: {
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
          "x-api-key": options.apiKey,
          "x-subject-id": options.subjectId,
        },
        ...(hasBody ? { body: JSON.stringify(requestOptions.body) } : {}),
      });
    } catch {
      throw new ApiError(0, "Could not reach the Memtavi API. Check MEMTAVI_API_URL.");
    }

    const payload = await readJson(response);
    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (!response.ok) {
      const mapped = errorMessage(payload);
      throw new ApiError(response.status, mapped.message, {
        code: mapped.code,
        requestId,
        retryAfterSeconds: retryAfter(response),
      });
    }

    return payload;
  }

  return {
    async listBrains() {
      const payload = await request("/v1/brains");
      return parseOrThrow(paginated(brainSchema), payload, "GET /v1/brains");
    },

    async getIndex(brainId, limit) {
      const payload = await request(`/v1/brains/${encodeURIComponent(brainId)}/index`, {
        query: limit === undefined ? undefined : { limit: String(limit) },
      });
      return parseOrThrow(paginated(indexEntrySchema), payload, "GET /v1/brains/{brainId}/index");
    },

    async search(brainId, query) {
      const payload = await request(`/v1/brains/${encodeURIComponent(brainId)}/search`, {
        query: {
          q: query.q,
          ...(query.limit === undefined ? {} : { limit: String(query.limit) }),
          ...(query.minSimilarity === undefined
            ? {}
            : { minSimilarity: String(query.minSimilarity) }),
        },
      });
      return parseOrThrow(paginated(searchHitSchema), payload, "GET /v1/brains/{brainId}/search");
    },

    async getPage(brainId, slug) {
      const payload = await request(
        `/v1/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}`,
      );
      return parseOrThrow(pageSchema, payload, "GET /v1/brains/{brainId}/pages/{slug}");
    },

    async createCapture(brainId, body) {
      const payload = await request(`/v1/brains/${encodeURIComponent(brainId)}/captures`, {
        body: {
          kind: body.kind,
          content: body.content,
          ...(body.label === undefined ? {} : { label: body.label }),
          ...(body.originRef === undefined ? {} : { originRef: body.originRef }),
        },
      });
      return parseOrThrow(sourceSchema, payload, "POST /v1/brains/{brainId}/captures");
    },

    async getSource(brainId, sourceId) {
      const payload = await request(
        `/v1/brains/${encodeURIComponent(brainId)}/sources/${encodeURIComponent(sourceId)}`,
      );
      return parseOrThrow(sourceSchema, payload, "GET /v1/brains/{brainId}/sources/{sourceId}");
    },
  };
}
