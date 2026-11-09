import { z } from "zod";

export type PageType = "source" | "topic" | "entity" | "project" | "decision" | "brief";

export type Bucket = "inbox" | "notes" | "ideas" | "projects";

export type PageStatus = "active" | "stale" | "contested" | "deprecated" | "archived";

export type DeletionState = "active" | "deleting" | "deleted";

export type SourceStatus = "pending" | "compiling" | "completed" | "failed";

export type CaptureKind = "note" | "url" | "file" | "transcript" | "chat_turn" | "integration";

export type ConnectionStrength = "weak" | "medium" | "strong";

export type ConnectionSource = "auto" | "manual";

export type ChangeAction =
  | "created"
  | "updated"
  | "renamed"
  | "merged"
  | "split"
  | "archived"
  | "restored"
  | "recovered"
  | "routed";

export type ChangeActor = "compiler" | "user";

export type TargetType = "brain" | "source" | "page";

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

export type BrainSummary = Pick<Brain, "id" | "name" | "slug">;

export interface BrainCreate {
  name: string;
  slug?: string | undefined;
  description?: string | undefined;
  projectId?: string | null | undefined;
  briefSettings?: Record<string, unknown> | undefined;
}

export interface IndexEntry {
  slug: string;
  title: string;
  summary: string;
  pageType: PageType;
  pinned: boolean;
  updatedAt?: string | undefined;
}

export interface SearchHit {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  pageType?: PageType | undefined;
  similarity: number | null;
  updatedAt?: string | undefined;
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
  bucket: Bucket;
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

export interface PageUpdate {
  title?: string | undefined;
  summary?: string | undefined;
  body?: string | undefined;
  bucket?: Bucket | undefined;
  pinned?: boolean | undefined;
  archived?: boolean | undefined;
  status?: PageStatus | undefined;
  version?: number | undefined;
}

export interface PageVersion {
  id: string;
  pageId: string;
  version: number;
  title: string;
  summary: string;
  body: string;
  ingestSourceId?: string | null | undefined;
  actor: ChangeActor;
  createdAt: string;
}

export interface PageList<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageQuery {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SearchQuery {
  q: string;
  limit?: number | undefined;
  minSimilarity?: number | undefined;
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
  bucket: Bucket;
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

export interface CaptureRequest {
  kind: CaptureKind;
  content?: string | null | undefined;
  fetchUrl?: string | null | undefined;
  originRef?: string | null | undefined;
  label?: string | null | undefined;
  bucket?: Bucket | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface DeletionReceipt {
  id: string;
  targetType: TargetType;
  state: string;
}

export interface Connection {
  id: string;
  brainId: string;
  pageAId: string;
  pageBId: string;
  similarity: number;
  strength: ConnectionStrength;
  reasoning: string;
  source: ConnectionSource;
  ackedAt: string | null;
}

export interface ChangeEvent {
  id: string;
  brainId: string;
  pageId: string;
  action: ChangeAction;
  changeSummary: string;
  fromVersion: number | null;
  toVersion: number;
  ingestSourceId: string | null;
  contradictions: unknown[];
  ackedAt: string | null;
  createdAt: string;
}

export interface Profile {
  brainId: string;
  whoTheyAre: string;
  whatTheyDo: string;
  focus: string;
  goals: string;
  currentProjects: string;
  stuckOn: string;
  vaultOrganization: string;
  directives: Record<string, unknown>;
}

export interface ProfileUpdate {
  whoTheyAre?: string | undefined;
  whatTheyDo?: string | undefined;
  focus?: string | undefined;
  goals?: string | undefined;
  currentProjects?: string | undefined;
  stuckOn?: string | undefined;
  vaultOrganization?: string | undefined;
  directives?: Record<string, unknown> | undefined;
}

export interface Score {
  brainId: string;
  computedAt: string;
  freshness: number;
  readiness: number;
  strain: number;
  factors: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  pageType: PageType;
  bucket: Bucket;
  status: PageStatus;
  pinned: boolean;
}

export interface GraphEdge {
  connectionId: string;
  pageAId: string;
  pageBId: string;
  similarity: number;
  strength: ConnectionStrength;
  source: ConnectionSource;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BrainExport {
  brain: Brain;
  pages: Page[];
  versions: PageVersion[];
  sources: IngestSource[];
  connections: Connection[];
}

export interface Webhook {
  id: string;
  subjectId: string;
  url: string;
  events: ChangeAction[];
  active: boolean;
  secret?: string | undefined;
}

export interface WebhookCreate {
  url: string;
  events: ChangeAction[];
}

export interface CreatedWebhook extends Webhook {
  secret: string;
}

export interface ApiClient {
  listBrains(query?: PageQuery): Promise<PageList<Brain>>;
  createBrain(body: BrainCreate): Promise<Brain>;
  getBrain(brainId: string): Promise<Brain>;
  createCapture(brainId: string, body: CaptureRequest): Promise<IngestSource>;
  getSource(brainId: string, sourceId: string): Promise<IngestSource>;
  listPages(brainId: string, query?: PageQuery): Promise<PageList<Page>>;
  getPage(brainId: string, slug: string): Promise<Page>;
  updatePage(brainId: string, slug: string, body: PageUpdate): Promise<Page>;
  deletePage(brainId: string, slug: string, options: { permanent: true }): Promise<DeletionReceipt>;
  search(brainId: string, query: SearchQuery): Promise<PageList<SearchHit>>;
  getIndex(brainId: string, limit?: number | undefined): Promise<PageList<IndexEntry>>;
  getGraph(brainId: string): Promise<Graph>;
  listConnections(brainId: string, query?: PageQuery): Promise<PageList<Connection>>;
  ackConnection(
    brainId: string,
    connectionId: string,
    acked?: boolean | undefined,
  ): Promise<Connection>;
  listChanges(brainId: string, query?: PageQuery): Promise<PageList<ChangeEvent>>;
  ackChange(brainId: string, changeId: string, acked?: boolean | undefined): Promise<ChangeEvent>;
  getScore(brainId: string): Promise<Score>;
  getProfile(brainId: string): Promise<Profile>;
  updateProfile(brainId: string, body: ProfileUpdate): Promise<Profile>;
  exportBrain(brainId: string): Promise<BrainExport>;
  listWebhooks(query?: PageQuery): Promise<PageList<Webhook>>;
  createWebhook(body: WebhookCreate): Promise<CreatedWebhook>;
  deleteWebhook(webhookId: string): Promise<void>;
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

const pageTypeSchema = z.enum(["source", "topic", "entity", "project", "decision", "brief"]);
const bucketSchema = z.enum(["inbox", "notes", "ideas", "projects"]);
const bucketSourceSchema = z.enum(["auto", "user"]);
const pageStatusSchema = z.enum(["active", "stale", "contested", "deprecated", "archived"]);
const deletionStateSchema = z.enum(["active", "deleting", "deleted"]);
const sourceStatusSchema = z.enum(["pending", "compiling", "completed", "failed"]);
const captureKindSchema = z.enum(["note", "url", "file", "transcript", "chat_turn", "integration"]);
const connectionStrengthSchema = z.enum(["weak", "medium", "strong"]);
const connectionSourceSchema = z.enum(["auto", "manual"]);
const changeActorSchema = z.enum(["compiler", "user"]);
const changeActionSchema = z.enum([
  "created",
  "updated",
  "renamed",
  "merged",
  "split",
  "archived",
  "restored",
  "recovered",
  "routed",
]);
const targetTypeSchema = z.enum(["brain", "source", "page"]);
const directivesSchema = z.record(z.string(), z.unknown());

const brainSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  projectId: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  briefSettings: z.record(z.string(), z.unknown()),
  deletionState: deletionStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const indexEntrySchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  pageType: pageTypeSchema,
  pinned: z.boolean(),
  updatedAt: z.string().optional(),
});

const searchHitSchema = z.object({
  pageId: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  pageType: pageTypeSchema.optional(),
  similarity: z.number().nullable(),
  updatedAt: z.string().optional(),
});

const pageSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  brainId: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  pageType: pageTypeSchema,
  bucket: bucketSchema,
  bucketSource: bucketSourceSchema,
  status: pageStatusSchema,
  pinned: z.boolean(),
  archived: z.boolean(),
  version: z.number(),
  entities: z.array(z.string()),
  backlinks: z.array(z.string()),
  contentHash: z.string(),
  embeddingModel: z.string().nullable(),
  lastCompiledAt: z.string().nullable(),
  lastReferencedAt: z.string().nullable(),
  userEditedAt: z.string().nullable(),
  deletionState: deletionStateSchema,
});

const pageVersionSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  version: z.number(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  ingestSourceId: z.string().nullable().optional(),
  actor: changeActorSchema,
  createdAt: z.string(),
});

const sourceSchema = z.object({
  id: z.string(),
  brainId: z.string(),
  kind: captureKindSchema,
  contentPreview: z.string(),
  contentUrl: z.string().nullable(),
  contentHash: z.string(),
  originRef: z.string().nullable(),
  label: z.string().nullable(),
  bucket: bucketSchema,
  metadata: z.record(z.string(), z.unknown()),
  status: sourceStatusSchema,
  attempts: z.number(),
  lastError: z.string().nullable(),
  affectedPageIds: z.array(z.string()),
  originalBytes: z.number(),
  createdAt: z.string(),
  compiledAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

const deletionReceiptSchema = z.object({
  id: z.string(),
  targetType: targetTypeSchema,
  state: z.string(),
});

const connectionSchema = z.object({
  id: z.string(),
  brainId: z.string(),
  pageAId: z.string(),
  pageBId: z.string(),
  similarity: z.number(),
  strength: connectionStrengthSchema,
  reasoning: z.string(),
  source: connectionSourceSchema,
  ackedAt: z.string().nullable(),
});

const changeEventSchema = z.object({
  id: z.string(),
  brainId: z.string(),
  pageId: z.string(),
  action: changeActionSchema,
  changeSummary: z.string(),
  fromVersion: z.number().nullable(),
  toVersion: z.number(),
  ingestSourceId: z.string().nullable(),
  contradictions: z.array(z.unknown()),
  ackedAt: z.string().nullable(),
  createdAt: z.string(),
});

const profileSchema = z.object({
  brainId: z.string(),
  whoTheyAre: z.string(),
  whatTheyDo: z.string(),
  focus: z.string(),
  goals: z.string(),
  currentProjects: z.string(),
  stuckOn: z.string(),
  vaultOrganization: z.string(),
  directives: directivesSchema,
});

const scoreSchema = z.object({
  brainId: z.string(),
  computedAt: z.string(),
  freshness: z.number(),
  readiness: z.number(),
  strain: z.number(),
  factors: z.record(z.string(), z.unknown()),
});

const graphNodeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  pageType: pageTypeSchema,
  bucket: bucketSchema,
  status: pageStatusSchema,
  pinned: z.boolean(),
});

const graphEdgeSchema = z.object({
  connectionId: z.string(),
  pageAId: z.string(),
  pageBId: z.string(),
  similarity: z.number(),
  strength: connectionStrengthSchema,
  source: connectionSourceSchema,
});

const graphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

const brainExportSchema = z.object({
  brain: brainSchema,
  pages: z.array(pageSchema),
  versions: z.array(pageVersionSchema),
  sources: z.array(sourceSchema),
  connections: z.array(connectionSchema),
});

const webhookSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  url: z.string(),
  events: z.array(changeActionSchema),
  active: z.boolean(),
  secret: z.string().optional(),
});

const createdWebhookSchema = webhookSchema.extend({ secret: z.string() });

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

function pageQuery(query: PageQuery | undefined): Record<string, string | undefined> | undefined {
  if (query === undefined) return undefined;
  return {
    ...(query.limit === undefined ? {} : { limit: String(query.limit) }),
    ...(query.offset === undefined ? {} : { offset: String(query.offset) }),
  };
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: HttpMethod | undefined;
  query?: Record<string, string | undefined> | undefined;
  body?: unknown;
}

function brainPath(brainId: string): string {
  return `/v1/brains/${encodeURIComponent(brainId)}`;
}

export function createClient(options: ClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.apiUrl.replace(/\/+$/, "");

  async function request(path: string, requestOptions: RequestOptions = {}): Promise<unknown> {
    const url = joinUrl(base, path, requestOptions.query);
    const hasBody = requestOptions.body !== undefined;
    const method = requestOptions.method ?? (hasBody ? "POST" : "GET");
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
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
    async listBrains(query) {
      const payload = await request("/v1/brains", { query: pageQuery(query) });
      return parseOrThrow(paginated(brainSchema), payload, "GET /v1/brains");
    },

    async createBrain(body) {
      const payload = await request("/v1/brains", {
        method: "POST",
        body: {
          name: body.name,
          ...(body.slug === undefined ? {} : { slug: body.slug }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
          ...(body.briefSettings === undefined ? {} : { briefSettings: body.briefSettings }),
        },
      });
      return parseOrThrow(brainSchema, payload, "POST /v1/brains");
    },

    async getBrain(brainId) {
      const payload = await request(brainPath(brainId));
      return parseOrThrow(brainSchema, payload, "GET /v1/brains/{brainId}");
    },

    async createCapture(brainId, body) {
      const payload = await request(`${brainPath(brainId)}/captures`, {
        method: "POST",
        body: {
          kind: body.kind,
          ...(body.content === undefined ? {} : { content: body.content }),
          ...(body.fetchUrl === undefined ? {} : { fetchUrl: body.fetchUrl }),
          ...(body.originRef === undefined ? {} : { originRef: body.originRef }),
          ...(body.label === undefined ? {} : { label: body.label }),
          ...(body.bucket === undefined ? {} : { bucket: body.bucket }),
          ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
        },
      });
      return parseOrThrow(sourceSchema, payload, "POST /v1/brains/{brainId}/captures");
    },

    async getSource(brainId, sourceId) {
      const payload = await request(
        `${brainPath(brainId)}/sources/${encodeURIComponent(sourceId)}`,
      );
      return parseOrThrow(sourceSchema, payload, "GET /v1/brains/{brainId}/sources/{sourceId}");
    },

    async listPages(brainId, query) {
      const payload = await request(`${brainPath(brainId)}/pages`, { query: pageQuery(query) });
      return parseOrThrow(paginated(pageSchema), payload, "GET /v1/brains/{brainId}/pages");
    },

    async getPage(brainId, slug) {
      const payload = await request(`${brainPath(brainId)}/pages/${encodeURIComponent(slug)}`);
      return parseOrThrow(pageSchema, payload, "GET /v1/brains/{brainId}/pages/{slug}");
    },

    async updatePage(brainId, slug, body) {
      const payload = await request(`${brainPath(brainId)}/pages/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        body: {
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.summary === undefined ? {} : { summary: body.summary }),
          ...(body.body === undefined ? {} : { body: body.body }),
          ...(body.bucket === undefined ? {} : { bucket: body.bucket }),
          ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
          ...(body.archived === undefined ? {} : { archived: body.archived }),
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.version === undefined ? {} : { version: body.version }),
        },
      });
      return parseOrThrow(pageSchema, payload, "PATCH /v1/brains/{brainId}/pages/{slug}");
    },

    async deletePage(brainId, slug, deleteOptions) {
      const payload = await request(`${brainPath(brainId)}/pages/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        query: { permanent: String(deleteOptions.permanent) },
      });
      return parseOrThrow(
        deletionReceiptSchema,
        payload,
        "DELETE /v1/brains/{brainId}/pages/{slug}",
      );
    },

    async search(brainId, query) {
      const payload = await request(`${brainPath(brainId)}/search`, {
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

    async getIndex(brainId, limit) {
      const payload = await request(`${brainPath(brainId)}/index`, {
        query: limit === undefined ? undefined : { limit: String(limit) },
      });
      return parseOrThrow(paginated(indexEntrySchema), payload, "GET /v1/brains/{brainId}/index");
    },

    async getGraph(brainId) {
      const payload = await request(`${brainPath(brainId)}/graph`);
      return parseOrThrow(graphSchema, payload, "GET /v1/brains/{brainId}/graph");
    },

    async listConnections(brainId, query) {
      const payload = await request(`${brainPath(brainId)}/connections`, {
        query: pageQuery(query),
      });
      return parseOrThrow(
        paginated(connectionSchema),
        payload,
        "GET /v1/brains/{brainId}/connections",
      );
    },

    async ackConnection(brainId, connectionId, acked = true) {
      const payload = await request(
        `${brainPath(brainId)}/connections/${encodeURIComponent(connectionId)}`,
        { method: "PATCH", body: { acked } },
      );
      return parseOrThrow(
        connectionSchema,
        payload,
        "PATCH /v1/brains/{brainId}/connections/{connectionId}",
      );
    },

    async listChanges(brainId, query) {
      const payload = await request(`${brainPath(brainId)}/changes`, { query: pageQuery(query) });
      return parseOrThrow(
        paginated(changeEventSchema),
        payload,
        "GET /v1/brains/{brainId}/changes",
      );
    },

    async ackChange(brainId, changeId, acked = true) {
      const payload = await request(
        `${brainPath(brainId)}/changes/${encodeURIComponent(changeId)}`,
        {
          method: "PATCH",
          body: { acked },
        },
      );
      return parseOrThrow(
        changeEventSchema,
        payload,
        "PATCH /v1/brains/{brainId}/changes/{changeId}",
      );
    },

    async getScore(brainId) {
      const payload = await request(`${brainPath(brainId)}/score`);
      return parseOrThrow(scoreSchema, payload, "GET /v1/brains/{brainId}/score");
    },

    async getProfile(brainId) {
      const payload = await request(`${brainPath(brainId)}/profile`);
      return parseOrThrow(profileSchema, payload, "GET /v1/brains/{brainId}/profile");
    },

    async updateProfile(brainId, body) {
      const payload = await request(`${brainPath(brainId)}/profile`, {
        method: "PATCH",
        body: {
          ...(body.whoTheyAre === undefined ? {} : { whoTheyAre: body.whoTheyAre }),
          ...(body.whatTheyDo === undefined ? {} : { whatTheyDo: body.whatTheyDo }),
          ...(body.focus === undefined ? {} : { focus: body.focus }),
          ...(body.goals === undefined ? {} : { goals: body.goals }),
          ...(body.currentProjects === undefined ? {} : { currentProjects: body.currentProjects }),
          ...(body.stuckOn === undefined ? {} : { stuckOn: body.stuckOn }),
          ...(body.vaultOrganization === undefined
            ? {}
            : { vaultOrganization: body.vaultOrganization }),
          ...(body.directives === undefined ? {} : { directives: body.directives }),
        },
      });
      return parseOrThrow(profileSchema, payload, "PATCH /v1/brains/{brainId}/profile");
    },

    async exportBrain(brainId) {
      const payload = await request(`${brainPath(brainId)}/export`);
      return parseOrThrow(brainExportSchema, payload, "GET /v1/brains/{brainId}/export");
    },

    async listWebhooks(query) {
      const payload = await request("/v1/webhooks", { query: pageQuery(query) });
      return parseOrThrow(paginated(webhookSchema), payload, "GET /v1/webhooks");
    },

    async createWebhook(body) {
      const payload = await request("/v1/webhooks", {
        method: "POST",
        body: { url: body.url, events: body.events },
      });
      return parseOrThrow(createdWebhookSchema, payload, "POST /v1/webhooks");
    },

    async deleteWebhook(webhookId) {
      await request(`/v1/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
    },
  };
}
