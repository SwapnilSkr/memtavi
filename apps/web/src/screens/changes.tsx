import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { PageReference } from "../components/page-reference";
import { StatusBadge } from "../components/status-badge";
import { versionTransition } from "../lib/activity";
import type { ChangeEvent, ListResponse, Page } from "../lib/api";
import { useApi } from "../lib/api-context";
import { formatDateTime, formatRelative } from "../lib/format";

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          <PageReference brainId={brainId} pageId={change.pageId} pages={pages} />
        </h2>
        <StatusBadge
          status={change.ackedAt ? "completed" : "pending"}
          label={change.ackedAt ? "Acknowledged" : "Unacknowledged"}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="badge badge-neutral">Action: {change.action}</span>
        <span className="badge badge-info">
          Version: {versionTransition(change.fromVersion, change.toVersion)}
        </span>
        <time dateTime={change.createdAt} title={formatDateTime(change.createdAt)}>
          {formatRelative(change.createdAt, now)}
        </time>
      </div>
      <p className="text-sm text-slate-800">{change.changeSummary || "No change summary"}</p>
      {change.contradictions.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-950">
          Contradictions: {change.contradictions.length}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 pt-1" aria-live="polite">
        {!change.ackedAt ? (
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={ack.isPending}
            onClick={() => ack.mutate()}
          >
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
      <div>
        <h1>Changes</h1>
        <p className="mt-1 text-slate-600">
          Review the latest changes to this brain, newest first.
        </p>
      </div>
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
            No changes yet.{" "}
            <Link to={`${base}/capture`} className="font-medium text-indigo-700 hover:underline">
              Capture a note or URL
            </Link>{" "}
            to get started.
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
