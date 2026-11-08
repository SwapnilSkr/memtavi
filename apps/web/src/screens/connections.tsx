import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { PageReference } from "../components/page-reference";
import type { Connection, ListResponse, Page } from "../lib/api";
import { useApi } from "../lib/api-context";

const params = { limit: 50, offset: 0 };

function ConnectionRow({
  connection,
  brainId,
  pages,
}: {
  connection: Connection;
  brainId: string;
  pages: readonly Page[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = ["connections", brainId, params];
  const ack = useMutation({
    mutationFn: () => api.ackConnection(brainId, connection.id, true),
    onMutate: () => queryClient.cancelQueries({ queryKey, exact: true }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ListResponse<Connection>>(queryKey, (current) =>
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
        <PageReference brainId={brainId} pageId={connection.pageAId} pages={pages} />
        <span className="mx-2" aria-hidden="true">
          ↔
        </span>
        <span className="sr-only"> connected to </span>
        <PageReference brainId={brainId} pageId={connection.pageBId} pages={pages} />
      </h2>
      <p className="text-sm text-slate-600">
        Strength: {connection.strength} · Similarity: {connection.similarity.toFixed(3)} · Source:{" "}
        {connection.source}
      </p>
      {connection.reasoning ? <p>{connection.reasoning}</p> : null}
      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <span>{connection.ackedAt ? "Acknowledged" : "Unacknowledged"}</span>
        {!connection.ackedAt ? (
          <button type="button" disabled={ack.isPending} onClick={() => ack.mutate()}>
            {ack.isPending ? "Acknowledging…" : "Acknowledge"}
          </button>
        ) : null}
      </div>
      <ErrorBanner error={ack.error} />
    </li>
  );
}

export function Connections() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const connections = useQuery({
    queryKey: ["connections", brainId, params],
    queryFn: () => api.listConnections(brainId, params),
  });
  const pages = useQuery({
    queryKey: ["pages", brainId, params],
    queryFn: () => api.listPages(brainId, params),
  });
  const base = `/brains/${encodeURIComponent(brainId)}`;
  return (
    <>
      <h1>Connections</h1>
      <p className="text-slate-600">
        Review connections by similarity, or <Link to={`${base}/graph`}>open the Graph</Link> for a
        visual view.
      </p>
      <ErrorBanner error={connections.error} />
      {pages.error ? (
        <p role="status" className="help">
          Page titles are unavailable. Showing page IDs instead.
        </p>
      ) : null}
      {connections.isPending ? <Loading label="Loading connections" /> : null}
      {connections.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No connections yet. <Link to={`${base}/capture`}>Capture more knowledge</Link> to
            connect related pages.
          </p>
        </EmptyState>
      ) : null}
      {connections.data && connections.data.items.length > 0 ? (
        <ul className="space-y-4" aria-label="Connections">
          {connections.data.items.map((connection) => (
            <ConnectionRow
              key={`${brainId}:${connection.id}`}
              connection={connection}
              brainId={brainId}
              pages={pages.data?.items ?? []}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
