import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { useApi } from "../lib/api-context";

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
      <h1>Search</h1>
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
          <input id="phrase" name="phrase" defaultValue={phrase} required />
        </div>
        <button className="primary" type="submit">
          Search
        </button>
      </form>
      <ErrorBanner error={results.error} />
      {!phrase ? (
        <EmptyState>
          <p>
            Enter a phrase above to search, or{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/pages`}>browse pages</Link>.
          </p>
        </EmptyState>
      ) : null}
      {phrase && results.isPending ? <Loading label="Searching pages" /> : null}
      {phrase && results.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No matches. Try another phrase above or{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/pages`}>browse pages</Link>.
          </p>
        </EmptyState>
      ) : null}
      {phrase && results.data ? (
        <p className="help" aria-live="polite">
          {results.data.items.length} results in API ranking order. Score is not provided by the
          API; similarity is the vector score only. Dispute status is unavailable in search results;
          open a page to inspect its status.
        </p>
      ) : null}
      <ol className="space-y-4">
        {phrase
          ? results.data?.items.map((hit, index) => (
              <li className="panel" key={hit.pageId}>
                <h2>
                  <Link
                    to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(hit.slug)}`}
                  >
                    {index + 1}. {hit.title}
                  </Link>
                </h2>
                <p className="mt-2 break-words text-slate-600">{hit.summary || "No summary"}</p>
                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="text-slate-500">Score</dt>
                    <dd>Not provided</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Similarity</dt>
                    <dd>
                      {hit.similarity === null ? "No vector score" : hit.similarity.toFixed(4)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Type</dt>
                    <dd>{hit.pageType ?? "Not provided"}</dd>
                  </div>
                  {hit.updatedAt ? (
                    <div>
                      <dt className="text-slate-500">Updated</dt>
                      <dd>
                        <time dateTime={hit.updatedAt}>
                          {new Date(hit.updatedAt).toLocaleString()}
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
