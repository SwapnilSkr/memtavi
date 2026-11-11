import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import type { ChangeEvent, Page } from "../lib/api";
import { useApi } from "../lib/api-context";
import { latestContradiction, readClaims } from "../lib/contradictions";
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
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="min-w-0" aria-label="Existing claim">
          <h4 className="text-sm font-semibold text-slate-500">Existing claim</h4>
          <p className="mt-1 break-words">{existingClaim}</p>
        </section>
        <section className="min-w-0" aria-label="New claim">
          <h4 className="text-sm font-semibold text-slate-500">New claim</h4>
          <p className="mt-1 break-words">{newClaim}</p>
        </section>
      </div>
      {quote ? <p className="break-words text-sm text-slate-600">Evidence quote: {quote}</p> : null}
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
      <h2 className="break-words">
        <Link to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}>
          {page.title}
        </Link>
      </h2>
      <p className="disputed" role="status">
        Disputed · contested
      </p>
      <p className="break-words text-slate-600">{page.summary || "No summary"}</p>
      {events === undefined ? <p>Loading contradiction events…</p> : null}
      {events === null ? <p>Contradiction events are unavailable.</p> : null}
      {event ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Latest contradiction ·{" "}
            <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
          </p>
          {event.changeSummary ? <p className="break-words">{event.changeSummary}</p> : null}
          {claims.length > 0 ? (
            <ol className="space-y-4">
              {claims.map((claim) => (
                <li key={`${claim.existingClaim}:${claim.newClaim}`}>
                  <ClaimPairView {...claim} />
                </li>
              ))}
            </ol>
          ) : (
            <p>This contradiction is not in a readable claim pair.</p>
          )}
        </div>
      ) : null}
      {events && !event ? <p>No contradiction event in the latest 200 changes.</p> : null}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!payload || resolve.isPending) return;
          resolve.mutate();
        }}
      >
        <div>
          <label htmlFor={`note-${page.id}`}>Resolution note</label>
          <textarea
            id={`note-${page.id}`}
            required
            maxLength={2000}
            rows={3}
            value={note}
            onChange={(change) => setNote(change.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`body-${page.id}`}>
            Edited body <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id={`body-${page.id}`}
            className="font-mono text-sm"
            rows={8}
            value={body}
            onChange={(change) => setBody(change.target.value)}
          />
          <p className="help">Leave this blank to keep the current body.</p>
        </div>
        <button className="primary" type="submit" disabled={!payload || resolve.isPending}>
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
      <h1>Conflicts</h1>
      <p className="text-slate-600">
        Contested pages and the newest contradiction for each one. Resolve with a note.
      </p>
      <div aria-live="polite" className="space-y-2">
        {resolved.map((item) => (
          <p key={item.id} role="status">
            Resolved “{item.title}”. The page is active again.
          </p>
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
            <Link to={`/brains/${encodeURIComponent(brainId)}/pages`}>Browse pages</Link> or{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/capture`}>capture a note or URL</Link>
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
