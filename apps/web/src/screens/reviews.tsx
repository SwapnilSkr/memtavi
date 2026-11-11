import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import type { RoutingReview } from "../lib/api";
import { useApi } from "../lib/api-context";
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
      <h2 className="break-words">{review.fact.claim}</h2>
      <p className="break-all text-sm text-slate-600">Source {review.sourceId}</p>
      <p className="break-words text-sm text-slate-600">
        Entities: {review.fact.entities.join(", ") || "None"}
      </p>
      {review.bestGap !== null ? (
        <p className="text-sm text-slate-600">Gap: {review.bestGap}</p>
      ) : null}
      <p className="break-words text-sm text-slate-600">
        Evidence quote: {review.fact.evidence.quote}
      </p>
      <time className="block text-sm text-slate-600" dateTime={review.createdAt}>
        {new Date(review.createdAt).toLocaleString()}
      </time>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!resolveBody || busy) return;
          resolve.mutate();
        }}
      >
        <fieldset className="min-w-0 space-y-3" disabled={busy}>
          <legend>Place this fact</legend>
          {review.candidates.map((candidate) => (
            <div key={candidate.pageId} className="flex items-start gap-3">
              <input
                className="mt-1 size-4 shrink-0"
                id={`placement-${review.id}-${candidate.pageId}`}
                type="radio"
                name={`placement-${review.id}`}
                value={candidate.pageId}
                checked={placement === candidate.pageId}
                onChange={() => setPlacement(candidate.pageId)}
              />
              <label
                className="min-w-0 font-normal"
                htmlFor={`placement-${review.id}-${candidate.pageId}`}
              >
                {candidate.title}
                <span className="text-slate-600"> · {candidate.slug}</span>
              </label>
              <Link
                to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(candidate.slug)}`}
              >
                Open
              </Link>
            </div>
          ))}
          <div className="flex items-start gap-3">
            <input
              className="mt-1 size-4 shrink-0"
              id={`placement-${review.id}-new`}
              type="radio"
              name={`placement-${review.id}`}
              value="new"
              checked={placement === "new"}
              onChange={() => setPlacement("new")}
            />
            <label className="font-normal" htmlFor={`placement-${review.id}-new`}>
              New page
            </label>
          </div>
        </fieldset>
        <div>
          <label htmlFor={`review-note-${review.id}`}>
            Note <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id={`review-note-${review.id}`}
            maxLength={2000}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="primary" type="submit" disabled={!resolveBody || busy}>
            {resolve.isPending ? "Resolving…" : "Resolve"}
          </button>
          <button
            type="button"
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
      <h1>Reviews</h1>
      <p className="text-slate-600">
        Open routing reviews. Resolve a fact onto a candidate or a new page, or dismiss it.
      </p>
      <div aria-live="polite" className="space-y-2">
        {settled.map((item) => (
          <p key={item.id} role="status">
            {item.message}
          </p>
        ))}
      </div>
      <ErrorBanner error={reviews.error} />
      {reviews.isPending ? <Loading label="Loading routing reviews" /> : null}
      {reviews.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No open routing reviews.{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/capture`}>Capture a note or URL</Link>{" "}
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
