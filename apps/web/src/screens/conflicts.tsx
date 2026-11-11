import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import { StatusBadge } from "../components/status-badge";
import type { ChangeEvent, Page } from "../lib/api";
import { useApi } from "../lib/api-context";
import { latestContradiction, readClaims } from "../lib/contradictions";
import { formatDateTime, formatRelative } from "../lib/format";
import { applyCacheEffect } from "../lib/invalidation";
import { listSearchParams, parseOffset } from "../lib/list-params";
import { pageResolveBody } from "../lib/resolve-form";

const pageSize = 50;

function ClaimPairView({
  existingClaim,
  newClaim,
  quote,
}: {
  existingClaim: string;
  newClaim: string;
  quote?: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {/* Side by side on desktop, stacked on phone */}
      <div className="grid gap-4 md:grid-cols-2">
        <section
          className="min-w-0 rounded-md border border-slate-200 bg-white p-3.5 shadow-xs"
          aria-label="Existing claim"
        >
          <div className="flex items-center gap-1.5">
            <span className="badge badge-neutral">Existing claim</span>
          </div>
          <p className="mt-2 break-words text-sm text-slate-800">{existingClaim}</p>
        </section>
        <section
          className="min-w-0 rounded-md border border-amber-200 bg-amber-50/50 p-3.5 shadow-xs"
          aria-label="New claim"
        >
          <div className="flex items-center gap-1.5">
            <span className="badge badge-warning">New claim</span>
          </div>
          <p className="mt-2 break-words text-sm text-slate-800">{newClaim}</p>
        </section>
      </div>
      {quote ? (
        <div className="rounded-md border-l-2 border-indigo-400 bg-white px-3 py-2 text-xs">
          <p className="break-words text-slate-600">
            <span className="font-semibold text-slate-700">Evidence quote:</span> {quote}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ConflictCard({
  brainId,
  page,
  events,
  onResolved,
}: {
  brainId: string;
  page: Page;
  events: readonly ChangeEvent[] | null | undefined;
  onResolved: (id: string, title: string) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [body, setBody] = useState("");
  const event = events ? latestContradiction(events, page.id) : undefined;
  const claims = event ? readClaims(event.contradictions) : [];
  const resolve = useMutation({
    mutationFn: () => {
      const payload = pageResolveBody(note, body);
      if (!payload) throw new Error("A resolution note is required.");
      return api.resolvePage(brainId, page.slug, payload);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(["page", brainId, { slug: page.slug }], updated);
      await applyCacheEffect(queryClient, "resolvePage", { brainId, slug: page.slug });
      onResolved(page.id, page.title);
    },
  });
  const payload = pageResolveBody(note, body);

  return (
    <li className="panel min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="break-words text-base font-semibold">
          <Link
            to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}
            className="text-slate-900 hover:text-indigo-700"
          >
            {page.title}
          </Link>
        </h2>
        <StatusBadge status="contested" className="disputed" />
      </div>
      <p className="break-words text-sm text-slate-600">{page.summary || "No summary"}</p>
      {events === undefined ? (
        <p className="text-xs text-slate-500">Loading contradiction events…</p>
      ) : null}
      {events === null ? (
        <p className="text-xs text-slate-500">Contradiction events are unavailable.</p>
      ) : null}
      {event ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <p className="text-xs text-slate-500">
            Latest contradiction ·{" "}
            <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
              {formatRelative(event.createdAt)}
            </time>
          </p>
          {event.changeSummary ? (
            <p className="break-words text-sm font-medium text-slate-800">{event.changeSummary}</p>
          ) : null}
          {claims.length > 0 ? (
            <ol className="space-y-3">
              {claims.map((claim) => (
                <li key={`${claim.existingClaim}:${claim.newClaim}`}>
                  <ClaimPairView {...claim} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-slate-500">
              This contradiction is not in a readable claim pair.
            </p>
          )}
        </div>
      ) : null}
      {events && !event ? (
        <p className="text-xs text-slate-500">No contradiction event in the latest 200 changes.</p>
      ) : null}
      <form
        className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!payload || resolve.isPending) return;
          resolve.mutate();
        }}
      >
        <h3 className="section-title">Resolve conflict</h3>
        <div>
          <label htmlFor={`note-${page.id}`}>Resolution note</label>
          <textarea
            id={`note-${page.id}`}
            required
            maxLength={2000}
            rows={3}
            placeholder="Explain how this conflict was settled…"
            value={note}
            onChange={(change) => setNote(change.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`body-${page.id}`}>
            Edited body <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id={`body-${page.id}`}
            className="font-mono text-xs sm:text-sm"
            rows={6}
            placeholder="Leave blank to keep the current page body…"
            value={body}
            onChange={(change) => setBody(change.target.value)}
          />
          <p className="help">Leave this blank to keep the current body.</p>
        </div>
        <button
          className="btn-primary text-xs"
          type="submit"
          disabled={!payload || resolve.isPending}
        >
          {resolve.isPending ? "Resolving…" : `Resolve ${page.title}`}
        </button>
      </form>
      <div aria-live="polite">
        <ErrorBanner error={resolve.error} />
      </div>
    </li>
  );
}

export function Conflicts() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const offset = parseOffset(params.get("offset"));
  const [resolved, setResolved] = useState<{ id: string; title: string }[]>([]);
  const pageParams = { limit: pageSize, offset, status: "contested" as const };
  const pages = useQuery({
    queryKey: ["pages", brainId, pageParams],
    queryFn: () => api.listPages(brainId, pageParams),
  });
  const changes = useQuery({
    queryKey: ["changes", brainId, { limit: 200, offset: 0 }],
    queryFn: () => api.listChanges(brainId, { limit: 200, offset: 0 }),
  });

  return (
    <>
      <div>
        <h1>Conflicts</h1>
        <p className="mt-1 text-slate-600">
          Contested pages and the newest contradiction for each one. Resolve with a note.
        </p>
      </div>
      <div aria-live="polite" className="space-y-2">
        {resolved.map((item) => (
          <div
            key={item.id}
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm text-emerald-900"
          >
            Resolved “{item.title}”. The page is active again.
          </div>
        ))}
      </div>
      <ErrorBanner error={pages.error} />
      {changes.error ? (
        <p role="status" className="help">
          Contradiction events are unavailable. You can still resolve a page with a note.
        </p>
      ) : null}
      {pages.isPending ? <Loading label="Loading contested pages" /> : null}
      {pages.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No contested pages.{" "}
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/pages`}
              className="font-medium text-indigo-700 hover:underline"
            >
              Browse pages
            </Link>{" "}
            or{" "}
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/capture`}
              className="font-medium text-indigo-700 hover:underline"
            >
              capture a note or URL
            </Link>
            .
          </p>
        </EmptyState>
      ) : null}
      {pages.data && pages.data.items.length > 0 ? (
        <ol className="space-y-4" aria-label="Contested pages">
          {pages.data.items.map((page) => (
            <ConflictCard
              key={page.id}
              brainId={brainId}
              page={page}
              events={
                changes.isPending ? undefined : changes.isError ? null : (changes.data?.items ?? [])
              }
              onResolved={(id, title) => setResolved((current) => [...current, { id, title }])}
            />
          ))}
        </ol>
      ) : null}
      {pages.data ? (
        <Pagination
          {...pages.data}
          pending={pages.isFetching}
          onChange={(next) => setParams(listSearchParams(undefined, next))}
        />
      ) : null}
    </>
  );
}
