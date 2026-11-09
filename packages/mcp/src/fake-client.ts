import type {
  ApiClient,
  BrainSummary,
  CaptureRequest,
  IndexEntry,
  IngestSource,
  Page,
  PageList,
  SearchHit,
  SearchQuery,
} from "./client";
import { ApiError } from "./client";

export interface FakeClientOptions {
  brains?: BrainSummary[];
  index?: IndexEntry[];
  hits?: SearchHit[];
  pages?: Record<string, Page>;
  capture?: IngestSource;
  sources?: Record<string, IngestSource>;
  failures?: Partial<Record<keyof ApiClient, unknown>>;
}

export interface Call {
  method: keyof ApiClient;
  args: unknown[];
}

export interface FakeClient extends ApiClient {
  calls: Call[];
}

function listed<T>(items: T[], limit: number): PageList<T> {
  return { items, total: items.length, limit, offset: 0 };
}

export function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const calls: Call[] = [];
  const brains = options.brains ?? [{ id: "brn_1", name: "Default", slug: "default" }];
  const failures = options.failures ?? {};

  const record = (method: keyof ApiClient, args: unknown[]) => {
    calls.push({ method, args });
  };

  const fail = (method: keyof ApiClient): never | undefined => {
    if (failures[method] !== undefined) throw failures[method];
    return undefined;
  };

  return {
    calls,
    async listBrains() {
      record("listBrains", []);
      fail("listBrains");
      return listed(brains, 50);
    },
    async getIndex(brainId, limit) {
      record("getIndex", [brainId, limit]);
      fail("getIndex");
      const entries = options.index ?? [];
      return listed(entries, limit ?? 40);
    },
    async search(brainId, query: SearchQuery) {
      record("search", [brainId, query]);
      fail("search");
      const hits = options.hits ?? [];
      return listed(hits, query.limit ?? 50);
    },
    async getPage(brainId, slug) {
      record("getPage", [brainId, slug]);
      fail("getPage");
      const page = options.pages?.[slug];
      if (page === undefined) {
        throw new ApiError(404, "Not found", { code: "NotFoundError" });
      }
      return page;
    },
    async createCapture(brainId: string, body: CaptureRequest) {
      record("createCapture", [brainId, body]);
      fail("createCapture");
      if (options.capture === undefined) {
        throw new ApiError(500, "No fake capture configured");
      }
      return options.capture;
    },
    async getSource(brainId: string, sourceId: string) {
      record("getSource", [brainId, sourceId]);
      fail("getSource");
      const source = options.sources?.[sourceId];
      if (source === undefined) {
        throw new ApiError(404, "Not found", { code: "NotFoundError" });
      }
      return source;
    },
  };
}
