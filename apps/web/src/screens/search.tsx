import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { useApi } from "../lib/api-context";
import { formatDateTime, formatRelative } from "../lib/format";

export function Search() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const phrase = (params.get("q") ?? "").trim();
  const results = useQuery({
    queryKey: ["search", brainId, { q: phrase, limit: 50 }],
    queryFn: () => api.search(brainId, { q: phrase, limit: 50 }),
    enabled: Boolean(phrase),
  });

  return (
    <>
      <div>
        <h1>Search</h1>
        <p className="mt-1 text-slate-600">
          Search knowledge pages across this brain using semantic vector similarity.
        </p>
      </div>
      <form
        className="panel flex flex-wrap items-end gap-3"
        key={phrase}
        onSubmit={(event) => {
          event.preventDefault();
          const q = String(new FormData(event.currentTarget).get("phrase") ?? "").trim();
          if (q === phrase && q) void results.refetch();
          else setParams(q ? { q } : {});
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="phrase">Search phrase</label>
          <input
            id="phrase"
            name="phrase"
            defaultValue={phrase}
            required
            placeholder="Search concepts, questions, or topics…"
          />
        </div>
        <button className="btn-primary text-xs" type="submit">
          Search
        </button>
      </form>
      <ErrorBanner error={results.error} />
      {!phrase ? (
        <EmptyState>
          <p>
            Enter a phrase above to search, or{" "}
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/pages`}
              className="font-medium text-indigo-700 hover:underline"
            >
              browse pages
            </Link>
            .
          </p>
        </EmptyState>
      ) : null}
      {phrase && results.isPending ? <Loading label="Searching pages" /> : null}
      {phrase && results.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No matches. Try another phrase above or{" "}
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/pages`}
              className="font-medium text-indigo-700 hover:underline"
            >
              browse pages
            </Link>
            .
          </p>
        </EmptyState>
      ) : null}
      {phrase && results.data ? (
        <p className="meta" aria-live="polite">
          {results.data.items.length} results in API ranking order. Score is not provided by the
          API; similarity is the vector score only. Dispute status is unavailable in search results;
          open a page to inspect its status.
        </p>
      ) : null}
      <ol className="space-y-4">
        {phrase
          ? results.data?.items.map((hit, index) => (
              <li className="panel space-y-3" key={hit.pageId}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    <Link
                      to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(hit.slug)}`}
                      className="text-slate-900 hover:text-indigo-700"
                    >
                      <span className="text-slate-400 font-normal mr-1">{index + 1}.</span>{" "}
                      {hit.title}
                    </Link>
                  </h2>
                  <div className="flex items-center gap-1.5">
                    {hit.pageType ? (
                      <span className="badge badge-neutral">{hit.pageType}</span>
                    ) : null}
                    {hit.similarity !== null ? (
                      <span className="badge badge-info font-mono">
                        {(hit.similarity * 100).toFixed(1)}% match
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="break-words text-sm text-slate-600">{hit.summary || "No summary"}</p>
                <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <div>
                    <dt className="inline text-slate-400">Score: </dt>
                    <dd className="inline font-medium text-slate-700">Not provided</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-400">Similarity: </dt>
                    <dd className="inline font-mono font-medium text-slate-700">
                      {hit.similarity === null ? "No vector score" : hit.similarity.toFixed(4)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-400">Type: </dt>
                    <dd className="inline font-medium text-slate-700">
                      {hit.pageType ?? "Not provided"}
                    </dd>
                  </div>
                  {hit.updatedAt ? (
                    <div>
                      <dt className="inline text-slate-400">Updated: </dt>
                      <dd className="inline font-medium text-slate-700">
                        <time dateTime={hit.updatedAt} title={formatDateTime(hit.updatedAt)}>
                          {formatRelative(hit.updatedAt)}
                        </time>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))
          : null}
      </ol>
    </>
  );
}
