import type { Session } from "./session";

export type DeletionState = "active" | "deleting" | "deleted";
export type PageType = "source" | "topic" | "entity" | "project" | "decision" | "brief";
export type PageStatus = "active" | "stale" | "contested" | "deprecated" | "archived";

export interface Brain {
  id: string;
  subjectId: string;
  projectId: string | null;
  name: string;
  slug: string;
  description: string;
  briefSettings: Record<string, unknown>;
  deletionState: DeletionState;
  createdAt: string;
  updatedAt: string;
}

export interface BrainCreate {
  name: string;
  slug?: string;
  description?: string;
  projectId?: string | null;
  briefSettings?: Record<string, unknown>;
}

export interface Page {
  id: string;
  subjectId: string;
  brainId: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  pageType: PageType;
  bucket: "inbox" | "notes" | "ideas" | "projects";
  bucketSource: "auto" | "user";
  status: PageStatus;
  pinned: boolean;
  archived: boolean;
  version: number;
  entities: string[];
  backlinks: string[];
  contentHash: string;
  embeddingModel: string | null;
  lastCompiledAt: string | null;
  lastReferencedAt: string | null;
  userEditedAt: string | null;
  deletionState: DeletionState;
}

export interface SearchHit {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  pageType?: PageType;
  similarity: number | null;
  updatedAt?: string;
}

export type CaptureKind = "note" | "url" | "file" | "transcript" | "chat_turn" | "integration";
export type SourceStatus = "pending" | "compiling" | "completed" | "failed";

export interface CaptureInput {
  kind: CaptureKind;
  content?: string | null;
  fetchUrl?: string | null;
  label?: string | null;
  originRef?: string | null;
  bucket?: Page["bucket"];
  metadata?: Record<string, unknown>;
}

export interface IngestSource {
  id: string;
  brainId: string;
  kind: CaptureKind;
  contentPreview: string;
  contentUrl: string | null;
  contentHash: string;
  originRef: string | null;
  label: string | null;
  bucket: Page["bucket"];
  metadata: Record<string, unknown>;
  status: SourceStatus;
  attempts: number;
  lastError: string | null;
  affectedPageIds: string[];
  originalBytes: number;
  createdAt: string;
  compiledAt: string | null;
  deletedAt: string | null;
}

export interface PageUpdate {
  title?: string;
  summary?: string;
  body?: string;
  bucket?: Page["bucket"];
  pinned?: boolean;
  archived?: boolean;
  status?: PageStatus;
  version: number;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Pagination {
  limit?: number;
  offset?: number;
}

export interface SearchParams {
  q: string;
  limit?: number;
  minSimilarity?: number;
}

export type GraphNode = Pick<
  Page,
  "id" | "slug" | "title" | "pageType" | "bucket" | "status" | "pinned"
>;

export interface GraphEdge {
  connectionId: string;
  pageAId: string;
  pageBId: string;
  similarity: number;
  strength: "weak" | "medium" | "strong";
  source: "auto" | "manual";
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Score {
  brainId: string;
  computedAt: string;
  freshness: number;
  readiness: number;
  strain: number;
  factors: Record<string, unknown>;
}

export interface ProfileFields {
  whoTheyAre: string;
  whatTheyDo: string;
  focus: string;
  goals: string;
  currentProjects: string;
  stuckOn: string;
  vaultOrganization: string;
  directives: Record<string, unknown>;
}

export interface Profile extends ProfileFields {
  brainId: string;
}

export type ProfileUpdate = Partial<ProfileFields>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly kind: "transient" | "permanent",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export function createApi(session: Session, fetcher: Fetcher = fetch) {
  async function request<T>(
    path: string,
    { method, body }: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
  ): Promise<T> {
    const headers = new Headers({
      "x-api-key": session.apiKey,
      "x-subject-id": session.subjectId,
      Accept: "application/json",
    });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetcher(`${session.baseUrl.replace(/\/+$/, "")}/v1${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        redirect: "error",
      });
    } catch {
      throw new ApiError(
        0,
        "NetworkError",
        "Unable to reach the API. Check your connection and base URL.",
        "transient",
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const envelope = payload && typeof payload === "object" ? payload : {};
      const detail =
        "body" in envelope && envelope.body && typeof envelope.body === "object"
          ? envelope.body
          : {};
      const message =
        "message" in detail && typeof detail.message === "string"
          ? detail.message
          : "message" in envelope && typeof envelope.message === "string"
            ? envelope.message
            : `Request failed (${response.status}).`;
      const code =
        "error" in detail && typeof detail.error === "string" ? detail.error : "HttpError";
      throw new ApiError(
        response.status,
        code,
        message,
        response.status === 429 || response.status >= 500 ? "transient" : "permanent",
      );
    }
    if (payload === null)
      throw new ApiError(
        response.status,
        "InvalidResponse",
        "The API returned an invalid JSON response.",
        "permanent",
      );
    return payload as T;
  }

  return {
    listBrains(params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<Brain>>(`/brains?${query}`);
    },
    getBrain(brainId: string) {
      return request<Brain>(`/brains/${encodeURIComponent(brainId)}`);
    },
    getGraph(brainId: string) {
      return request<Graph>(`/brains/${encodeURIComponent(brainId)}/graph`);
    },
    getScore(brainId: string) {
      return request<Score>(`/brains/${encodeURIComponent(brainId)}/score`);
    },
    getProfile(brainId: string) {
      return request<Profile>(`/brains/${encodeURIComponent(brainId)}/profile`);
    },
    updateProfile(brainId: string, body: ProfileUpdate) {
      return request<Profile>(`/brains/${encodeURIComponent(brainId)}/profile`, {
        method: "PATCH",
        body,
      });
    },
    createBrain(body: BrainCreate) {
      return request<Brain>("/brains", { body });
    },
    capture(brainId: string, body: CaptureInput) {
      return request<IngestSource>(`/brains/${encodeURIComponent(brainId)}/captures`, { body });
    },
    getSource(brainId: string, sourceId: string) {
      return request<IngestSource>(
        `/brains/${encodeURIComponent(brainId)}/sources/${encodeURIComponent(sourceId)}`,
      );
    },
    updatePage(brainId: string, slug: string, body: PageUpdate) {
      return request<Page>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}`,
        { method: "PATCH", body },
      );
    },
    listPages(brainId: string, params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<Page>>(`/brains/${encodeURIComponent(brainId)}/pages?${query}`);
    },
    getPage(brainId: string, slug: string) {
      return request<Page>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}`,
      );
    },
    search(brainId: string, params: SearchParams) {
      const query = new URLSearchParams({ q: params.q, limit: String(params.limit ?? 50) });
      if (params.minSimilarity !== undefined)
        query.set("minSimilarity", String(params.minSimilarity));
      return request<ListResponse<SearchHit>>(
        `/brains/${encodeURIComponent(brainId)}/search?${query}`,
      );
    },
  };
}

export type Api = ReturnType<typeof createApi>;
