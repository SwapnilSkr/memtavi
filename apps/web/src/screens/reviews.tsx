import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import type { RoutingReview } from "../lib/api";
import { useApi } from "../lib/api-context";
import { formatDateTime, formatRelative } from "../lib/format";
import { applyCacheEffect } from "../lib/invalidation";
import { listSearchParams, parseOffset } from "../lib/list-params";
import { reviewDismissBody, reviewResolveBody } from "../lib/reviews";

const pageSize = 50;

function ReviewCard({
  brainId,
  review,
  onSettled,
}: {
  brainId: string;
  review: RoutingReview;
  onSettled: (id: string, message: string) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [placement, setPlacement] = useState("");
  const [note, setNote] = useState("");
  const resolveBody = reviewResolveBody(placement, note);
  const dismissBody = reviewDismissBody(note);
  const resolve = useMutation({
    mutationFn: () => {
      if (!resolveBody) throw new Error("Choose a candidate page or a new page.");
      return api.resolveRoutingReview(brainId, review.id, resolveBody);
    },
    onSuccess: async () => {
      await applyCacheEffect(queryClient, "resolveRoutingReview", { brainId });
      onSettled(
        review.id,
        `Resolved the review for “${review.fact.claim}”. Placement continues in the background.`,
      );
    },
  });
  const dismiss = useMutation({
    mutationFn: () =>
      dismissBody
        ? api.dismissRoutingReview(brainId, review.id, dismissBody)
        : api.dismissRoutingReview(brainId, review.id),
    onSuccess: async () => {
      await applyCacheEffect(queryClient, "dismissRoutingReview", { brainId });
      onSettled(review.id, `Dismissed the review for “${review.fact.claim}”. The source is kept.`);
    },
  });
  const busy = resolve.isPending || dismiss.isPending;

  return (
    <li className="panel min-w-0 space-y-4">
      <div className="space-y-1">
        <h2 className="break-words text-base font-semibold text-slate-900">{review.fact.claim}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-mono">Source {review.sourceId}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={review.createdAt} title={formatDateTime(review.createdAt)}>
            {formatRelative(review.createdAt)}
          </time>
          {review.bestGap !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Gap: {review.bestGap}</span>
            </>
          ) : null}
        </div>
      </div>

      {review.fact.entities.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="meta">Entities:</span>
          {review.fact.entities.map((entity) => (
            <span key={entity} className="badge badge-neutral">
              {entity}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-md border-l-2 border-indigo-400 bg-slate-50 p-3 text-xs">
        <p className="break-words text-slate-700">
          <span className="font-semibold text-slate-800">Evidence quote:</span>{" "}
          {review.fact.evidence.quote}
        </p>
      </div>

      <form
        className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!resolveBody || busy) return;
          resolve.mutate();
        }}
      >
        <fieldset className="min-w-0 space-y-3" disabled={busy}>
          <legend className="section-title">Place this fact</legend>
          <div className="space-y-2">
            {review.candidates.map((candidate) => (
              <label
                key={candidate.pageId}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm cursor-pointer hover:bg-slate-50"
              >
                <input
                  className="mt-1 size-4 shrink-0"
                  id={`placement-${review.id}-${candidate.pageId}`}
                  type="radio"
                  name={`placement-${review.id}`}
                  value={candidate.pageId}
                  checked={placement === candidate.pageId}
                  onChange={() => setPlacement(candidate.pageId)}
                />
                <span className="min-w-0 flex-1 font-normal text-slate-800">
                  <span className="font-semibold">{candidate.title}</span>
                  <span className="text-xs text-slate-500 font-mono"> · {candidate.slug}</span>
                </span>
                <Link
                  to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(candidate.slug)}`}
                  className="text-xs text-indigo-700 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open ↗
                </Link>
              </label>
            ))}
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm cursor-pointer hover:bg-slate-50">
              <input
                className="mt-1 size-4 shrink-0"
                id={`placement-${review.id}-new`}
                type="radio"
                name={`placement-${review.id}`}
                value="new"
                checked={placement === "new"}
                onChange={() => setPlacement("new")}
              />
              <span className="font-medium text-slate-800">Create a new page</span>
            </label>
          </div>
        </fieldset>

        <div>
          <label htmlFor={`review-note-${review.id}`}>
            Note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id={`review-note-${review.id}`}
            maxLength={2000}
            rows={2}
            placeholder="Add context or rationale for this placement…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn-primary text-xs" type="submit" disabled={!resolveBody || busy}>
            {resolve.isPending ? "Resolving…" : "Resolve"}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={busy}
            onClick={() => {
              if (!busy) dismiss.mutate();
            }}
          >
            {dismiss.isPending ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
        <p className="help">
          Resolve places the fact on the selected page, or on a new page. Dismiss keeps the source
          and does not place the fact.
        </p>
      </form>
      <div aria-live="polite">
        <ErrorBanner error={resolve.error ?? dismiss.error} />
      </div>
    </li>
  );
}

export function Reviews() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const offset = parseOffset(params.get("offset"));
  const [settled, setSettled] = useState<{ id: string; message: string }[]>([]);
  const reviewParams = { limit: pageSize, offset, status: "open" as const };
  const reviews = useQuery({
    queryKey: ["routing-reviews", brainId, reviewParams],
    queryFn: () => api.listRoutingReviews(brainId, reviewParams),
  });

  return (
    <>
      <div>
        <h1>Reviews</h1>
        <p className="mt-1 text-slate-600">
          Open routing reviews. Resolve a fact onto a candidate or a new page, or dismiss it.
        </p>
      </div>
      <div aria-live="polite" className="space-y-2">
        {settled.map((item) => (
          <div
            key={item.id}
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm text-emerald-900"
          >
            {item.message}
          </div>
        ))}
      </div>
      <ErrorBanner error={reviews.error} />
      {reviews.isPending ? <Loading label="Loading routing reviews" /> : null}
      {reviews.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No open routing reviews.{" "}
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/capture`}
              className="font-medium text-indigo-700 hover:underline"
            >
              Capture a note or URL
            </Link>{" "}
            to compile new facts.
          </p>
        </EmptyState>
      ) : null}
      {reviews.data && reviews.data.items.length > 0 ? (
        <ol className="space-y-4" aria-label="Open routing reviews">
          {reviews.data.items.map((review) => (
            <ReviewCard
              key={review.id}
              brainId={brainId}
              review={review}
              onSettled={(id, message) => setSettled((current) => [...current, { id, message }])}
            />
          ))}
        </ol>
      ) : null}
      {reviews.data ? (
        <Pagination
          {...reviews.data}
          pending={reviews.isFetching}
          onChange={(next) => setParams(listSearchParams(undefined, next))}
        />
      ) : null}
    </>
  );
}
