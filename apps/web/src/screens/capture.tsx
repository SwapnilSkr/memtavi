import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import type { CaptureInput, IngestSource, ListResponse } from "../lib/api";
import { useApi } from "../lib/api-context";
import {
  newlyCompleted,
  SOURCE_POLL_LIMIT_MS,
  sourcePollingInterval,
  sourceStatusKey,
  sourcesPollingInterval,
  upsertSource,
} from "../lib/capture";
import { applyCacheEffect, captureSettledEffect } from "../lib/invalidation";

const pageSize = 50;
const queueLimit = 200;

function cachedPageId(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("id" in data)) return undefined;
  return typeof data.id === "string" ? data.id : undefined;
}

function SourceRow({
  brainId,
  source,
  listKey,
}: {
  brainId: string;
  source: IngestSource;
  listKey: readonly unknown[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const name = source.label || source.id;
  function store(updated: IngestSource) {
    queryClient.setQueryData<ListResponse<IngestSource>>(listKey, (current) =>
      upsertSource(current, updated),
    );
  }
  const retry = useMutation({
    mutationFn: () => api.retryIngestSource(brainId, source.id),
    onSuccess: async (updated) => {
      store(updated);
      await applyCacheEffect(queryClient, "retryIngestSource", {
        brainId,
        sourceId: updated.id,
      });
    },
  });
  const approve = useMutation({
    mutationFn: () => api.approveIngestSource(brainId, source.id),
    onSuccess: async (updated) => {
      store(updated);
      await applyCacheEffect(queryClient, "approveIngestSource", {
        brainId,
        sourceId: updated.id,
      });
    },
  });
  const busy = retry.isPending || approve.isPending;
  return (
    <li className="panel min-w-0 space-y-3">
      <h3 className="break-words text-base font-semibold">{name}</h3>
      <p className="break-all text-sm text-slate-600">Source {source.id}</p>
      {source.contentPreview ? (
        <p className="line-clamp-3 break-words text-slate-700">{source.contentPreview}</p>
      ) : null}
      <div aria-live="polite" aria-atomic="true" className="space-y-2">
        <p>
          Status: {source.status}
          {source.awaitingApproval ? " · Awaiting approval" : ""}
        </p>
        <p>Attempts: {source.attempts}</p>
        {source.lastError ? <p className="error-banner">{source.lastError}</p> : null}
        {source.status === "completed" ? (
          <p>
            {source.affectedPageIds.length} affected pages.{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/pages`}>Open pages</Link>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        {source.status === "failed" ? (
          <button type="button" disabled={busy} onClick={() => retry.mutate()}>
            {retry.isPending ? "Retrying…" : `Retry ${name}`}
          </button>
        ) : null}
        {source.awaitingApproval ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => approve.mutate()}
          >
            {approve.isPending ? "Approving…" : `Approve ${name}`}
          </button>
        ) : null}
      </div>
      <ErrorBanner error={retry.error ?? approve.error} />
    </li>
  );
}

function CaptureComposer({ brainId }: { brainId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"note" | "url">("note");
  const [content, setContent] = useState("");
  const [fetchUrl, setFetchUrl] = useState("");
  const [label, setLabel] = useState("");
  const [offset, setOffset] = useState(0);
  const [unstored, setUnstored] = useState(false);
  const previous = useRef(new Map<string, IngestSource["status"]>());
  const pollClock = useRef<{ key: string; at: number } | null>(null);
  function elapsedSinceStatusChange(items: readonly IngestSource[] | undefined): number {
    const key = sourceStatusKey(items);
    const now = Date.now();
    if (pollClock.current?.key !== key) {
      pollClock.current = { key, at: now };
      return 0;
    }
    return now - pollClock.current.at;
  }
  const listParams = { limit: queueLimit, offset: 0 };
  const listKey = ["sources", brainId, listParams] as const;
  const sources = useQuery({
    queryKey: listKey,
    queryFn: () => api.listIngestSources(brainId, listParams),
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      return sourcesPollingInterval(items, elapsedSinceStatusChange(items));
    },
  });
  const elapsed = elapsedSinceStatusChange(sources.data?.items);
  const pollStalled =
    sourcesPollingInterval(sources.data?.items, elapsed) === false &&
    sources.data?.items.some((source) => sourcePollingInterval(source) !== false) === true;
  function restartPolling() {
    pollClock.current = { key: sourceStatusKey(sources.data?.items), at: Date.now() };
    void sources.refetch();
  }
  const visible = sources.data?.items.slice(offset, offset + pageSize) ?? [];
  const capture = useMutation({
    mutationFn: (input: CaptureInput) => api.capture(brainId, input),
    onSuccess: async (source) => {
      setContent("");
      setFetchUrl("");
      setLabel("");
      if (source.stored === false) {
        setUnstored(true);
        return;
      }
      setUnstored(false);
      setOffset(0);
      queryClient.setQueryData<ListResponse<IngestSource>>(listKey, (current) => {
        return (
          upsertSource(current, source) ?? {
            items: [source],
            total: 1,
            limit: queueLimit,
            offset: 0,
          }
        );
      });
      await applyCacheEffect(queryClient, "createCapture", { brainId });
    },
  });
  useEffect(() => {
    const items = sources.data?.items;
    if (!items) return;
    const finished = newlyCompleted(previous.current, items);
    for (const source of items) previous.current.set(source.id, source.status);
    if (finished.length === 0) return;
    const affectedPageIds = finished.flatMap((source) => source.affectedPageIds);
    for (const query of queryClient.getQueryCache().findAll()) {
      if (
        captureSettledEffect(query.queryKey, cachedPageId(query.state.data), {
          brainId,
          affectedPageIds,
        })
      ) {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  }, [brainId, queryClient, sources.data]);
  return (
    <>
      <h1>Capture</h1>
      <p className="text-slate-600">
        Add a note or URL. The queue slows its checks while a source is still processing, and pauses
        after {SOURCE_POLL_LIMIT_MS / 60_000} minutes without a status change.
      </p>
      <ErrorBanner error={capture.error} />
      {unstored ? <p role="status">Memory is off, so this capture was not stored.</p> : null}
      <form
        className="panel space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (capture.isPending || !(kind === "note" ? content.trim() : fetchUrl.trim())) return;
          capture.mutate({
            kind,
            ...(kind === "note" ? { content } : { fetchUrl: fetchUrl.trim() }),
            ...(label.trim() ? { label: label.trim() } : {}),
          });
        }}
      >
        <fieldset disabled={capture.isPending} className="min-w-0 space-y-5">
          <legend className="sr-only">Capture content</legend>
          <div>
            <label htmlFor="capture-kind">Kind</label>
            <select
              id="capture-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value === "url" ? "url" : "note")}
            >
              <option value="note">Note</option>
              <option value="url">URL</option>
            </select>
          </div>
          {kind === "note" ? (
            <div>
              <label htmlFor="capture-note">Note</label>
              <textarea
                id="capture-note"
                required
                maxLength={50000}
                rows={8}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>
          ) : (
            <div>
              <label htmlFor="capture-url">URL</label>
              <input
                id="capture-url"
                type="url"
                required
                value={fetchUrl}
                onChange={(event) => setFetchUrl(event.target.value)}
              />
            </div>
          )}
          <div>
            <label htmlFor="capture-label">Label (optional)</label>
            <input
              id="capture-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <button
            className="primary"
            type="submit"
            disabled={capture.isPending || !(kind === "note" ? content.trim() : fetchUrl.trim())}
          >
            {capture.isPending ? "Capturing…" : "Capture"}
          </button>
        </fieldset>
      </form>
      <section aria-labelledby="sources-heading" className="space-y-4">
        <h2 id="sources-heading">Queue</h2>
        {pollStalled ? (
          <p role="status">
            <button type="button" onClick={restartPolling}>
              Still processing — Refresh
            </button>
          </p>
        ) : null}
        <ErrorBanner error={sources.error} />
        {sources.isPending ? <Loading label="Loading sources" /> : null}
        {sources.data && sources.data.total > sources.data.items.length ? (
          <p className="help" role="status">
            Showing the newest {sources.data.items.length} of {sources.data.total}. Polling follows
            this window.
          </p>
        ) : null}
        {sources.data?.items.length === 0 ? (
          <EmptyState>Add a note or URL above to start compiling pages.</EmptyState>
        ) : null}
        {visible.length > 0 ? (
          <ul className="space-y-4">
            {visible.map((source) => (
              <SourceRow key={source.id} brainId={brainId} source={source} listKey={listKey} />
            ))}
          </ul>
        ) : null}
        {sources.data ? (
          <Pagination
            total={sources.data.items.length}
            limit={pageSize}
            offset={offset}
            pending={sources.isFetching}
            onChange={setOffset}
          />
        ) : null}
      </section>
    </>
  );
}

export function Capture() {
  const { brainId = "" } = useParams();
  return <CaptureComposer key={brainId} brainId={brainId} />;
}
