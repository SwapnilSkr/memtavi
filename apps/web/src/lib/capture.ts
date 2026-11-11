import type { ListResponse, SourceStatus } from "./api";

export const SOURCE_POLL_MS = 1_500;
export const SOURCE_POLL_CEILING_MS = 30_000;
export const SOURCE_POLL_LIMIT_MS = 10 * 60 * 1_000;

export function sourcePollingInterval(
  source: { status: SourceStatus; awaitingApproval?: boolean } | undefined,
): typeof SOURCE_POLL_MS | false {
  if (!source || source.awaitingApproval) return false;
  return source.status === "pending" || source.status === "compiling" ? SOURCE_POLL_MS : false;
}

export function sourceStatusKey(
  sources: readonly { id: string; status: SourceStatus; awaitingApproval?: boolean }[] | undefined,
): string {
  if (!sources) return "";
  return sources
    .map((source) => [source.id, source.status, source.awaitingApproval ? "1" : "0"].join("\u0000"))
    .sort()
    .join("\n");
}

export function sourcesPollingInterval(
  sources: readonly { status: SourceStatus; awaitingApproval?: boolean }[] | undefined,
  elapsedSinceStatusChangeMs = 0,
): number | false {
  if (!sources?.some((source) => sourcePollingInterval(source) === SOURCE_POLL_MS)) return false;
  if (elapsedSinceStatusChangeMs >= SOURCE_POLL_LIMIT_MS) return false;
  let interval: number = SOURCE_POLL_MS;
  let tierEnd = 0;
  while (interval < SOURCE_POLL_CEILING_MS) {
    tierEnd += interval;
    if (elapsedSinceStatusChangeMs < tierEnd) return interval;
    interval = Math.min(SOURCE_POLL_CEILING_MS, interval * 2);
  }
  return interval;
}

export function newlyCompleted<T extends { id: string; status: SourceStatus }>(
  previous: ReadonlyMap<string, SourceStatus>,
  sources: readonly T[],
): T[] {
  return sources.filter((source) => {
    const prior = previous.get(source.id);
    return prior !== undefined && prior !== "completed" && source.status === "completed";
  });
}

export function upsertSource<T extends { id: string }>(
  current: ListResponse<T> | undefined,
  source: T,
): ListResponse<T> | undefined {
  if (!current) return current;
  const exists = current.items.some((item) => item.id === source.id);
  return {
    ...current,
    items: exists
      ? current.items.map((item) => (item.id === source.id ? source : item))
      : [source, ...current.items],
    total: exists ? current.total : current.total + 1,
  };
}
