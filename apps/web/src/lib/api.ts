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

export interface BrainUpdate {
  name?: string;
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
  awaitingApproval?: boolean;
  stored?: boolean;
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

export interface PageVersion {
  id: string;
  pageId: string;
  version: number;
  title: string;
  summary: string;
  body: string;
  ingestSourceId: string | null;
  actor: "compiler" | "user";
  createdAt: string;
}

export interface PageVersionSummary {
  version: number;
  title: string;
  summary: string;
  actor: "compiler" | "user";
  ingestSourceId: string | null;
  createdAt: string;
}

export interface PageVersionDetail extends PageVersionSummary {
  body: string;
}

export interface PageVersionField {
  from: string;
  to: string;
}

export interface PageVersionDiffLine {
  op: "context" | "add" | "remove";
  text: string;
}

export interface PageVersionHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PageVersionDiffLine[];
}

export interface PageVersionDiff {
  from: number;
  to: number;
  title: PageVersionField;
  summary: PageVersionField;
  hunks: PageVersionHunk[];
}

export interface PageResolve {
  note: string;
  title?: string;
  summary?: string;
  body?: string;
}

export interface IndexEntry {
  slug: string;
  title: string;
  summary: string;
  pageType: PageType;
  pinned: boolean;
  status?: PageStatus;
  updatedAt?: string;
}

export interface Connection {
  id: string;
  brainId: string;
  pageAId: string;
  pageBId: string;
  similarity: number;
  strength: "weak" | "medium" | "strong";
  reasoning: string;
  source: "auto" | "manual";
  ackedAt: string | null;
}

export interface ChangeEvent {
  id: string;
  brainId: string;
  pageId: string;
  action:
    | "created"
    | "updated"
    | "renamed"
    | "merged"
    | "split"
    | "archived"
    | "restored"
    | "recovered"
    | "routed";
  changeSummary: string;
  fromVersion: number | null;
  toVersion: number;
  ingestSourceId: string | null;
  contradictions: unknown[];
  ackedAt: string | null;
  createdAt: string;
}

export interface ExportBundle {
  brain: Brain;
  pages: Page[];
  versions: PageVersion[];
  sources: IngestSource[];
  connections: Connection[];
}

export interface DeletionReceipt {
  id: string;
  targetType: "brain" | "source" | "page";
  state: string;
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

export interface PageListParams extends Pagination {
  status?: PageStatus;
}

export interface RoutingReviewCandidate {
  pageId: string;
  slug: string;
  title: string;
}

export interface RoutingReview {
  id: string;
  sourceId: string;
  fact: {
    claim: string;
    entities: string[];
    evidence: {
      chunkUuid: string;
      charStart: number;
      charEnd: number;
      quote: string;
    };
  };
  candidates: RoutingReviewCandidate[];
  bestGap: number | null;
  status: "open" | "resolved" | "dismissed";
  resolution: string | null;
  createdAt: string;
}

export type RoutingReviewResolve =
  | { pageId: string; note?: string }
  | { newPage: true; note?: string };

export interface RoutingReviewDismiss {
  note?: string;
}

export interface RoutingReviewListParams extends Pagination {
  status?: RoutingReview["status"];
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
  factors: Partial<Record<HealthMetric, HealthFactor[]>>;
}

export type HealthMetric = "freshness" | "readiness" | "strain";

export interface HealthFactor {
  key: string;
  label: string;
  description: string;
  value: number;
  unit: string;
  tone: "positive" | "neutral" | "negative";
}

export type ScorePoint = Pick<Score, "computedAt" | HealthMetric>;

export interface ScoreHistory {
  range: "7d" | "30d" | "90d";
  points: ScorePoint[];
  delta: Record<HealthMetric, number> | null;
}

export interface ScoreSuggestions {
  generatedBy: "rules";
  basedOn: string;
  items: {
    key: string;
    title: string;
    description: string;
    action: string;
    actionLabel: string;
    priority: "high" | "medium" | "low";
  }[];
}

export type MemberRole = "owner" | "admin" | "developer" | "viewer";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  role: MemberRole;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreate {
  name: string;
  role?: MemberRole;
  scopes?: string[];
  expiresAt?: string | null;
}

export interface Webhook {
  id: string;
  subjectId: string;
  url: string;
  events: string[];
  active: boolean;
}

export interface WebhookCreate {
  url: string;
  events: string[];
}

export interface Member {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: MemberRole;
  createdAt: string;
}

export interface MemorySettings {
  mode: "auto" | "ask" | "off";
  updatedAt: string | null;
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

export interface ProfileSuggestion {
  field: Exclude<keyof ProfileFields, "directives">;
  value: string;
  confidence: number;
  evidence: { slug: string; title: string }[];
}

export interface ProfileSuggestions {
  generatedBy: "model";
  model: string;
  promptHash: string;
  items: ProfileSuggestion[];
}

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
    { method, body }: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = {},
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
    if (response.status === 204 && response.ok) return undefined as T;
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
    getScoreHistory(brainId: string, range: ScoreHistory["range"] = "30d") {
      return request<ScoreHistory>(
        `/brains/${encodeURIComponent(brainId)}/score/history?${new URLSearchParams({ range })}`,
      );
    },
    getScoreSuggestions(brainId: string) {
      return request<ScoreSuggestions>(`/brains/${encodeURIComponent(brainId)}/score/suggestions`, {
        method: "POST",
      });
    },
    suggestProfile(brainId: string) {
      return request<ProfileSuggestions>(
        `/brains/${encodeURIComponent(brainId)}/profile/suggestions`,
        {
          method: "POST",
        },
      );
    },
    getMemorySettings() {
      return request<MemorySettings>("/memory-settings");
    },
    updateMemorySettings(body: Pick<MemorySettings, "mode">) {
      return request<MemorySettings>("/memory-settings", { method: "PUT", body });
    },
    listApiKeys(params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<ApiKey>>(`/api-keys?${query}`);
    },
    createApiKey(body: ApiKeyCreate) {
      return request<ApiKey & { key?: string }>("/api-keys", { body });
    },
    deleteApiKey(keyId: string) {
      return request<void>(`/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
    },
    listWebhooks(params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<Webhook>>(`/webhooks?${query}`);
    },
    createWebhook(body: WebhookCreate) {
      return request<Webhook & { secret?: string }>("/webhooks", { body });
    },
    deleteWebhook(webhookId: string) {
      return request<void>(`/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
    },
    listMembers(params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<Member>>(`/members?${query}`);
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
    updateBrain(brainId: string, body: BrainUpdate) {
      return request<Brain>(`/brains/${encodeURIComponent(brainId)}`, { method: "PATCH", body });
    },
    deleteBrain(brainId: string) {
      return request<DeletionReceipt>(`/brains/${encodeURIComponent(brainId)}`, {
        method: "DELETE",
      });
    },
    capture(brainId: string, body: CaptureInput) {
      return request<IngestSource>(`/brains/${encodeURIComponent(brainId)}/captures`, { body });
    },
    getSource(brainId: string, sourceId: string) {
      return request<IngestSource>(
        `/brains/${encodeURIComponent(brainId)}/sources/${encodeURIComponent(sourceId)}`,
      );
    },
    listIngestSources(brainId: string, params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<IngestSource>>(
        `/brains/${encodeURIComponent(brainId)}/sources?${query}`,
      );
    },
    retryIngestSource(brainId: string, sourceId: string) {
      return request<IngestSource>(
        `/brains/${encodeURIComponent(brainId)}/sources/${encodeURIComponent(sourceId)}/retry`,
        { method: "POST" },
      );
    },
    approveIngestSource(brainId: string, sourceId: string) {
      return request<IngestSource>(
        `/brains/${encodeURIComponent(brainId)}/sources/${encodeURIComponent(sourceId)}/approve`,
        { method: "POST" },
      );
    },
    updatePage(brainId: string, slug: string, body: PageUpdate) {
      return request<Page>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}`,
        { method: "PATCH", body },
      );
    },
    listPages(brainId: string, params: PageListParams = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      if (params.status) query.set("status", params.status);
      return request<ListResponse<Page>>(`/brains/${encodeURIComponent(brainId)}/pages?${query}`);
    },
    getIndex(brainId: string, params: PageListParams = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 40),
        offset: String(params.offset ?? 0),
      });
      if (params.status) query.set("status", params.status);
      return request<ListResponse<IndexEntry>>(
        `/brains/${encodeURIComponent(brainId)}/index?${query}`,
      );
    },
    listPageVersions(brainId: string, slug: string, params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<PageVersionSummary>>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}/versions?${query}`,
      );
    },
    getPageVersion(brainId: string, slug: string, version: number) {
      return request<PageVersionDetail>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}/versions/${version}`,
      );
    },
    diffPageVersions(brainId: string, slug: string, params: { from: number; to?: number }) {
      const query = new URLSearchParams({ from: String(params.from) });
      if (params.to !== undefined) query.set("to", String(params.to));
      return request<PageVersionDiff>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}/diff?${query}`,
      );
    },
    resolvePage(brainId: string, slug: string, body: PageResolve) {
      return request<Page>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}/resolve`,
        { method: "POST", body },
      );
    },
    listRoutingReviews(brainId: string, params: RoutingReviewListParams = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      if (params.status) query.set("status", params.status);
      return request<ListResponse<RoutingReview>>(
        `/brains/${encodeURIComponent(brainId)}/routing-reviews?${query}`,
      );
    },
    resolveRoutingReview(brainId: string, reviewId: string, body: RoutingReviewResolve) {
      return request<RoutingReview>(
        `/brains/${encodeURIComponent(brainId)}/routing-reviews/${encodeURIComponent(reviewId)}/resolve`,
        { method: "POST", body },
      );
    },
    dismissRoutingReview(brainId: string, reviewId: string, body?: RoutingReviewDismiss) {
      return request<RoutingReview>(
        `/brains/${encodeURIComponent(brainId)}/routing-reviews/${encodeURIComponent(reviewId)}/dismiss`,
        body ? { method: "POST", body } : { method: "POST" },
      );
    },
    listConnections(brainId: string, params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<Connection>>(
        `/brains/${encodeURIComponent(brainId)}/connections?${query}`,
      );
    },
    ackConnection(brainId: string, connectionId: string, acked: boolean) {
      return request<Connection>(
        `/brains/${encodeURIComponent(brainId)}/connections/${encodeURIComponent(connectionId)}`,
        { method: "PATCH", body: { acked } },
      );
    },
    listChanges(brainId: string, params: Pagination = {}) {
      const query = new URLSearchParams({
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      });
      return request<ListResponse<ChangeEvent>>(
        `/brains/${encodeURIComponent(brainId)}/changes?${query}`,
      );
    },
    ackChange(brainId: string, changeId: string, acked: boolean) {
      return request<ChangeEvent>(
        `/brains/${encodeURIComponent(brainId)}/changes/${encodeURIComponent(changeId)}`,
        { method: "PATCH", body: { acked } },
      );
    },
    getPage(brainId: string, slug: string) {
      return request<Page>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}`,
      );
    },
    exportBrain(brainId: string) {
      return request<ExportBundle>(`/brains/${encodeURIComponent(brainId)}/export`);
    },
    deletePage(brainId: string, slug: string) {
      return request<DeletionReceipt>(
        `/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(slug)}?permanent=true`,
        { method: "DELETE" },
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
