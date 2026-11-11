export type CacheMutation =
  | "updateBrain"
  | "deleteBrain"
  | "createCapture"
  | "retryIngestSource"
  | "approveIngestSource"
  | "updatePage"
  | "deletePage"
  | "resolvePage"
  | "resolveRoutingReview"
  | "dismissRoutingReview";

export type CacheEffect = "invalidate" | "drop" | "keep";

export interface CacheScope {
  brainId: string;
  slug?: string;
  sourceId?: string;
}

const pageLists = new Set(["pages", "search", "graph", "changes", "index"]);
const versionResources = new Set(["page-versions", "page-version", "page-diff"]);
const captureLists = new Set([
  "pages",
  "search",
  "graph",
  "changes",
  "connections",
  "index",
  "routing-reviews",
]);

function resourceOf(queryKey: readonly unknown[]): string | undefined {
  return typeof queryKey[0] === "string" ? queryKey[0] : undefined;
}

function param(queryKey: readonly unknown[], name: string): unknown {
  const value = queryKey[2];
  if (!value || typeof value !== "object" || !Object.hasOwn(value, name)) return undefined;
  return (value as Record<string, unknown>)[name];
}

interface QueryCacheClient {
  getQueryCache(): { findAll(): readonly { queryKey: readonly unknown[] }[] };
  invalidateQueries(filters: { queryKey: readonly unknown[]; exact: true }): Promise<unknown>;
  removeQueries(filters: { queryKey: readonly unknown[]; exact: true }): unknown;
}

export function queryEffect(
  mutation: CacheMutation,
  queryKey: readonly unknown[],
  scope: CacheScope,
): CacheEffect {
  const name = resourceOf(queryKey);
  if (!name) return "keep";
  const onBrain = queryKey[1] === scope.brainId;
  switch (mutation) {
    case "updateBrain":
      if (name === "brains") return "invalidate";
      if (name === "brain" && onBrain) return "invalidate";
      return "keep";
    case "deleteBrain":
      if (name === "brains") return "invalidate";
      if (onBrain) return "drop";
      return "keep";
    case "createCapture":
      return name === "sources" && onBrain ? "invalidate" : "keep";
    case "retryIngestSource":
    case "approveIngestSource":
      if (name === "sources" && onBrain) return "invalidate";
      if (name === "source" && onBrain && param(queryKey, "sourceId") === scope.sourceId) {
        return "invalidate";
      }
      return "keep";
    case "updatePage":
    case "resolvePage":
      if (!onBrain) return "keep";
      if (pageLists.has(name)) return "invalidate";
      if (versionResources.has(name) && param(queryKey, "slug") === scope.slug) return "invalidate";
      return "keep";
    case "deletePage":
      if (!onBrain) return "keep";
      if (pageLists.has(name) || name === "connections") return "invalidate";
      if (
        (name === "page" || versionResources.has(name)) &&
        param(queryKey, "slug") === scope.slug
      ) {
        return "drop";
      }
      return "keep";
    case "resolveRoutingReview":
    case "dismissRoutingReview":
      return name === "routing-reviews" && onBrain ? "invalidate" : "keep";
  }
}

export function captureSettledEffect(
  queryKey: readonly unknown[],
  pageId: string | undefined,
  scope: { brainId: string; affectedPageIds: readonly string[] },
): boolean {
  if (queryKey[1] !== scope.brainId) return false;
  const name = resourceOf(queryKey);
  if (name !== undefined && captureLists.has(name)) return true;
  return name === "page" && pageId !== undefined && scope.affectedPageIds.includes(pageId);
}

export async function applyCacheEffect(
  queryClient: QueryCacheClient,
  mutation: CacheMutation,
  scope: CacheScope,
): Promise<void> {
  await Promise.all(
    queryClient
      .getQueryCache()
      .findAll()
      .map((query) => {
        const effect = queryEffect(mutation, query.queryKey, scope);
        if (effect === "invalidate") {
          return queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
        }
        if (effect === "drop") {
          return queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
        }
        return Promise.resolve();
      }),
  );
}
