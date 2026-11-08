import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import type { CaptureInput, Page } from "../lib/api";
import { useApi } from "../lib/api-context";
import { sourcePollingInterval } from "../lib/capture";

function SourceStatus({ brainId, sourceId }: { brainId: string; sourceId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const source = useQuery({
    queryKey: ["source", brainId, { sourceId }],
    queryFn: () => api.getSource(brainId, sourceId),
    refetchInterval: (query) => sourcePollingInterval(query.state.data?.status),
  });
  const data = source.data;
  useEffect(() => {
    if (data?.status !== "completed") return;
    for (const query of queryClient.getQueryCache().findAll()) {
      const [resource, cachedBrainId] = query.queryKey;
      if (cachedBrainId !== brainId) continue;
      if (
        resource === "pages" ||
        resource === "search" ||
        (resource === "page" && data.affectedPageIds.includes((query.state.data as Page)?.id))
      ) {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  }, [brainId, data, queryClient]);
  return (
    <li className="panel min-w-0 space-y-3">
      <h2 className="break-words">{data?.label || sourceId}</h2>
      <ErrorBanner error={source.error} />
      {source.error ? (
        <button type="button" disabled={source.isFetching} onClick={() => void source.refetch()}>
          Retry status check
        </button>
      ) : null}
      {source.isPending ? <Loading label="Loading source" /> : null}
      <div aria-live="polite" aria-atomic="true" className="space-y-2">
        {data ? (
          <>
            <p>Status: {data.status}</p>
            <p>Attempts: {data.attempts}</p>
            {data.status === "failed" ? (
              <p className="error-banner">{data.lastError || "Compilation failed."}</p>
            ) : null}
            {data.status === "completed" ? (
              <p>
                {data.affectedPageIds.length} affected pages.{" "}
                <Link to={`/brains/${encodeURIComponent(brainId)}/pages`}>Open pages</Link>
              </p>
            ) : null}
          </>
        ) : null}
      </div>
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
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const capture = useMutation({
    mutationFn: (input: CaptureInput) => api.capture(brainId, input),
    onSuccess: (source) => {
      queryClient.setQueryData(["source", brainId, { sourceId: source.id }], source);
      setSourceIds((current) => [source.id, ...current.filter((id) => id !== source.id)]);
      setContent("");
      setFetchUrl("");
      setLabel("");
    },
  });
  return (
    <>
      <h1>Capture</h1>
      <p className="text-slate-600">Add a note or URL, then watch its compilation status below.</p>
      <ErrorBanner error={capture.error} />
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
        <h2 id="sources-heading">Captured this visit</h2>
        {sourceIds.length === 0 ? (
          <EmptyState>Add a note or URL above to start compiling pages.</EmptyState>
        ) : (
          <ul className="space-y-4">
            {sourceIds.map((sourceId) => (
              <SourceStatus key={sourceId} brainId={brainId} sourceId={sourceId} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function Capture() {
  const { brainId = "" } = useParams();
  return <CaptureComposer key={brainId} brainId={brainId} />;
}
