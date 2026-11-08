import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { PageReference } from "../components/page-reference";
import { relativeTime, versionTransition } from "../lib/activity";
import type { ChangeEvent, ListResponse, Page } from "../lib/api";
import { useApi } from "../lib/api-context";

const params = { limit: 50, offset: 0 };

function ChangeRow({
  change,
  brainId,
  pages,
  now,
}: {
  change: ChangeEvent;
  brainId: string;
  pages: readonly Page[];
  now: number;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = ["changes", brainId, params];
  const ack = useMutation({
    mutationFn: () => api.ackChange(brainId, change.id, true),
    onMutate: () => queryClient.cancelQueries({ queryKey, exact: true }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ListResponse<ChangeEvent>>(queryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });
  return (
    <li className="panel min-w-0 space-y-3 break-words">
      <h2>
        <PageReference brainId={brainId} pageId={change.pageId} pages={pages} />
      </h2>
      <p className="text-sm text-slate-600">
        Action: {change.action} · Version: {versionTransition(change.fromVersion, change.toVersion)}
      </p>
      <p>{change.changeSummary || "No change summary"}</p>
      {change.contradictions.length > 0 ? (
        <p className="font-semibold text-amber-950">
          Contradictions: {change.contradictions.length}
        </p>
      ) : null}
      <time
        className="block text-sm text-slate-600"
        dateTime={change.createdAt}
        title={new Date(change.createdAt).toLocaleString()}
      >
        {relativeTime(change.createdAt, now)}
      </time>
      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <span>{change.ackedAt ? "Acknowledged" : "Unacknowledged"}</span>
        {!change.ackedAt ? (
          <button type="button" disabled={ack.isPending} onClick={() => ack.mutate()}>
            {ack.isPending ? "Acknowledging…" : "Acknowledge"}
          </button>
        ) : null}
      </div>
      <ErrorBanner error={ack.error} />
    </li>
  );
}

export function Changes() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const changes = useQuery({
    queryKey: ["changes", brainId, params],
    queryFn: () => api.listChanges(brainId, params),
  });
  const pages = useQuery({
    queryKey: ["pages", brainId, params],
    queryFn: () => api.listPages(brainId, params),
  });
  const now = Date.now();
  const base = `/brains/${encodeURIComponent(brainId)}`;
  return (
    <>
      <h1>Changes</h1>
      <p className="text-slate-600">Review the latest changes to this brain, newest first.</p>
      <ErrorBanner error={changes.error} />
      {pages.error ? (
        <p role="status" className="help">
          Page titles are unavailable. Showing page IDs instead.
        </p>
      ) : null}
      {changes.isPending ? <Loading label="Loading changes" /> : null}
      {changes.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No changes yet. <Link to={`${base}/capture`}>Capture a note or URL</Link> to get
            started.
          </p>
        </EmptyState>
      ) : null}
      {changes.data && changes.data.items.length > 0 ? (
        <ol className="space-y-4" aria-label="Changes, newest first">
          {changes.data.items.map((change) => (
            <ChangeRow
              key={`${brainId}:${change.id}`}
              change={change}
              brainId={brainId}
              pages={pages.data?.items ?? []}
              now={now}
            />
          ))}
        </ol>
      ) : null}
    </>
  );
}
