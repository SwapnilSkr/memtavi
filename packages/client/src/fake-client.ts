import {
  type ApiClient,
  ApiError,
  type Brain,
  type BrainCreate,
  type BrainExport,
  type CaptureRequest,
  type ChangeEvent,
  type Connection,
  type CreatedWebhook,
  type DeletionReceipt,
  type Graph,
  type IndexEntry,
  type IngestSource,
  type Page,
  type PageList,
  type PageQuery,
  type PageUpdate,
  type Profile,
  type ProfileUpdate,
  type Score,
  type SearchHit,
  type SearchQuery,
  type Webhook,
  type WebhookCreate,
} from "./client";

const EPOCH = "2026-01-01T00:00:00.000Z";

type Loosen<T> = { [K in keyof T]: T[K] extends string ? string : T[K] };

type BrainInput = Partial<Loosen<Brain>> & Pick<Loosen<Brain>, "id" | "name" | "slug">;
type PageInput = Partial<Loosen<Page>> &
  Pick<
    Loosen<Page>,
    "id" | "slug" | "title" | "summary" | "body" | "pageType" | "status" | "version"
  >;
type SourceInput = Partial<Loosen<IngestSource>> &
  Pick<Loosen<IngestSource>, "id" | "brainId" | "status">;

export interface FakeClientOptions {
  brains?: BrainInput[];
  index?: Loosen<IndexEntry>[];
  hits?: Loosen<SearchHit>[];
  pages?: Record<string, PageInput>;
  pageList?: Page[];
  capture?: SourceInput;
  sources?: Record<string, SourceInput>;
  sourceList?: IngestSource[];
  connections?: Connection[];
  changes?: ChangeEvent[];
  graph?: Graph;
  score?: Score;
  profile?: Profile;
  exported?: BrainExport;
  created?: BrainInput;
  deletion?: DeletionReceipt;
  webhooks?: Webhook[];
  createdWebhook?: CreatedWebhook;
  failures?: Partial<Record<keyof ApiClient, unknown>>;
}

export interface Call {
  method: keyof ApiClient;
  args: unknown[];
}

export interface FakeClient extends ApiClient {
  calls: Call[];
}

export function fakeBrain(input: BrainInput): Brain {
  return {
    subjectId: "sub_1",
    projectId: null,
    description: "",
    briefSettings: {},
    deletionState: "active",
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...(input as Partial<Brain>),
  } as Brain;
}

export function fakePage(input: PageInput): Page {
  return {
    subjectId: "sub_1",
    brainId: "brn_1",
    bucket: "inbox",
    bucketSource: "auto",
    pinned: false,
    archived: false,
    entities: [],
    backlinks: [],
    contentHash: "",
    embeddingModel: null,
    lastCompiledAt: null,
    lastReferencedAt: null,
    userEditedAt: null,
    deletionState: "active",
    ...(input as Partial<Page>),
  } as Page;
}

export function fakeSource(input: SourceInput): IngestSource {
  return {
    kind: "note",
    contentPreview: "",
    contentUrl: null,
    contentHash: "",
    originRef: null,
    label: null,
    bucket: "inbox",
    metadata: {},
    attempts: 0,
    lastError: null,
    affectedPageIds: [],
    originalBytes: 0,
    createdAt: EPOCH,
    compiledAt: null,
    deletedAt: null,
    ...(input as Partial<IngestSource>),
  } as IngestSource;
}

function emptyProfile(brainId: string): Profile {
  return {
    brainId,
    whoTheyAre: "",
    whatTheyDo: "",
    focus: "",
    goals: "",
    currentProjects: "",
    stuckOn: "",
    vaultOrganization: "",
    directives: {},
  };
}

function listed<T>(items: T[], limit: number, offset: number): PageList<T> {
  return { items, total: items.length, limit, offset };
}

export function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const calls: Call[] = [];
  const brains = (options.brains ?? [{ id: "brn_1", name: "Default", slug: "default" }]).map(
    fakeBrain,
  );
  const failures = options.failures ?? {};

  const record = (method: keyof ApiClient, args: unknown[]) => {
    calls.push({ method, args });
  };

  const fail = (method: keyof ApiClient): undefined => {
    if (failures[method] !== undefined) throw failures[method];
    return undefined;
  };

  const findPage = (slug: string): Page => {
    const page = options.pages?.[slug];
    if (page === undefined) {
      throw new ApiError(404, "Not found", { code: "NotFoundError" });
    }
    return fakePage(page);
  };

  return {
    calls,

    async listBrains(query?: PageQuery) {
      record("listBrains", [query]);
      fail("listBrains");
      return listed(brains, query?.limit ?? 50, query?.offset ?? 0);
    },

    async createBrain(body: BrainCreate) {
      record("createBrain", [body]);
      fail("createBrain");
      return fakeBrain(
        options.created ?? { id: "brn_new", name: body.name, slug: body.slug ?? "new-brain" },
      );
    },

    async getBrain(brainId: string) {
      record("getBrain", [brainId]);
      fail("getBrain");
      const brain = brains.find((item) => item.id === brainId);
      if (brain === undefined) throw new ApiError(404, "Not found", { code: "NotFoundError" });
      return brain;
    },

    async createCapture(brainId: string, body: CaptureRequest) {
      record("createCapture", [brainId, body]);
      fail("createCapture");
      if (options.capture === undefined) {
        throw new ApiError(500, "No fake capture configured");
      }
      return fakeSource(options.capture);
    },

    async getSource(brainId: string, sourceId: string) {
      record("getSource", [brainId, sourceId]);
      fail("getSource");
      const source = options.sources?.[sourceId];
      if (source === undefined) {
        throw new ApiError(404, "Not found", { code: "NotFoundError" });
      }
      return fakeSource(source);
    },

    async listPages(brainId: string, query?: PageQuery) {
      record("listPages", [brainId, query]);
      fail("listPages");
      const pages =
        options.pageList ?? Object.values(options.pages ?? {}).map((page) => fakePage(page));
      const offset = query?.offset ?? 0;
      const limit = query?.limit ?? 50;
      return listed(pages.slice(offset, offset + limit), limit, offset);
    },

    async getPage(brainId: string, slug: string) {
      record("getPage", [brainId, slug]);
      fail("getPage");
      return findPage(slug);
    },

    async updatePage(brainId: string, slug: string, body: PageUpdate) {
      record("updatePage", [brainId, slug, body]);
      fail("updatePage");
      const page = findPage(slug);
      return {
        ...page,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.summary === undefined ? {} : { summary: body.summary }),
        ...(body.body === undefined ? {} : { body: body.body }),
        ...(body.bucket === undefined ? {} : { bucket: body.bucket }),
        ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
        ...(body.archived === undefined ? {} : { archived: body.archived }),
        ...(body.status === undefined ? {} : { status: body.status }),
        version: page.version + 1,
      };
    },

    async deletePage(brainId: string, slug: string, deleteOptions: { permanent: true }) {
      record("deletePage", [brainId, slug, deleteOptions]);
      fail("deletePage");
      return options.deletion ?? { id: "pg_1", targetType: "page", state: "deleted" };
    },

    async search(brainId: string, query: SearchQuery) {
      record("search", [brainId, query]);
      fail("search");
      const hits = (options.hits ?? []) as SearchHit[];
      return listed(hits, query.limit ?? 50, 0);
    },

    async getIndex(brainId: string, limit?: number) {
      record("getIndex", [brainId, limit]);
      fail("getIndex");
      return listed((options.index ?? []) as IndexEntry[], limit ?? 40, 0);
    },

    async getGraph(brainId: string) {
      record("getGraph", [brainId]);
      fail("getGraph");
      return options.graph ?? { nodes: [], edges: [] };
    },

    async listConnections(brainId: string, query?: PageQuery) {
      record("listConnections", [brainId, query]);
      fail("listConnections");
      const connections = options.connections ?? [];
      return listed(
        connections.slice(query?.offset ?? 0, (query?.offset ?? 0) + (query?.limit ?? 50)),
        query?.limit ?? 50,
        query?.offset ?? 0,
      );
    },

    async ackConnection(brainId: string, connectionId: string, acked = true) {
      record("ackConnection", [brainId, connectionId, acked]);
      fail("ackConnection");
      const found = options.connections?.find((item) => item.id === connectionId);
      if (found === undefined) throw new ApiError(404, "Not found", { code: "NotFoundError" });
      return { ...found, ackedAt: acked ? EPOCH : null };
    },

    async listChanges(brainId: string, query?: PageQuery) {
      record("listChanges", [brainId, query]);
      fail("listChanges");
      const changes = options.changes ?? [];
      return listed(
        changes.slice(query?.offset ?? 0, (query?.offset ?? 0) + (query?.limit ?? 50)),
        query?.limit ?? 50,
        query?.offset ?? 0,
      );
    },

    async ackChange(brainId: string, changeId: string, acked = true) {
      record("ackChange", [brainId, changeId, acked]);
      fail("ackChange");
      const found = options.changes?.find((item) => item.id === changeId);
      if (found === undefined) throw new ApiError(404, "Not found", { code: "NotFoundError" });
      return { ...found, ackedAt: acked ? EPOCH : null };
    },

    async getScore(brainId: string) {
      record("getScore", [brainId]);
      fail("getScore");
      return (
        options.score ?? {
          brainId,
          computedAt: EPOCH,
          freshness: 0,
          readiness: 0,
          strain: 0,
          factors: {},
        }
      );
    },

    async getProfile(brainId: string) {
      record("getProfile", [brainId]);
      fail("getProfile");
      return options.profile ?? emptyProfile(brainId);
    },

    async updateProfile(brainId: string, body: ProfileUpdate) {
      record("updateProfile", [brainId, body]);
      fail("updateProfile");
      const current = options.profile ?? emptyProfile(brainId);
      return {
        brainId,
        whoTheyAre: body.whoTheyAre ?? current.whoTheyAre,
        whatTheyDo: body.whatTheyDo ?? current.whatTheyDo,
        focus: body.focus ?? current.focus,
        goals: body.goals ?? current.goals,
        currentProjects: body.currentProjects ?? current.currentProjects,
        stuckOn: body.stuckOn ?? current.stuckOn,
        vaultOrganization: body.vaultOrganization ?? current.vaultOrganization,
        directives: body.directives ?? current.directives,
      };
    },

    async exportBrain(brainId: string) {
      record("exportBrain", [brainId]);
      fail("exportBrain");
      return (
        options.exported ?? {
          brain: brains[0] ?? fakeBrain({ id: "brn_1", name: "Default", slug: "default" }),
          pages: [],
          versions: [],
          sources: [],
          connections: [],
        }
      );
    },

    async listWebhooks(query?: PageQuery) {
      record("listWebhooks", [query]);
      fail("listWebhooks");
      const webhooks = options.webhooks ?? [];
      return listed(
        webhooks.slice(query?.offset ?? 0, (query?.offset ?? 0) + (query?.limit ?? 50)),
        query?.limit ?? 50,
        query?.offset ?? 0,
      );
    },

    async createWebhook(body: WebhookCreate) {
      record("createWebhook", [body]);
      fail("createWebhook");
      return (
        options.createdWebhook ?? {
          id: "whk_1",
          subjectId: "sub_1",
          url: body.url,
          events: body.events,
          active: true,
          secret: "whsec_test_secret",
        }
      );
    },

    async deleteWebhook(webhookId: string) {
      record("deleteWebhook", [webhookId]);
      fail("deleteWebhook");
    },
  };
}
