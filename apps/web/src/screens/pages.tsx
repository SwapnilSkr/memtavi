import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import { useApi } from "../lib/api-context";
import { exportFilename } from "../lib/export";

export function Pages() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const rawOffset = Number(params.get("offset") ?? 0);
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const pages = useQuery({
    queryKey: ["pages", brainId, { limit: 50, offset }],
    queryFn: () => api.listPages(brainId, { limit: 50, offset }),
  });
  const download = useMutation({
    mutationFn: () => api.exportBrain(brainId),
    onSuccess: (bundle) => {
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFilename(bundle.brain.slug);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
  });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1>Pages</h1>
        <button type="button" disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? "Exporting…" : "Download export"}
        </button>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <ErrorBanner error={pages.error ?? download.error} />
        {download.isSuccess ? <p className="help">Export downloaded.</p> : null}
      </div>
      {pages.isPending ? <Loading label="Loading pages" /> : null}
      {pages.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No pages on this page.{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/capture`}>Capture a note or URL</Link>
            , <Link to={`/brains/${encodeURIComponent(brainId)}/search`}>Search this brain</Link> or{" "}
            <Link to="/">choose another brain</Link>.
          </p>
        </EmptyState>
      ) : null}
      {pages.data && pages.data.items.length > 0 ? (
        <section className="panel" aria-label="Pages">
          <table className="pages-table">
            <caption className="sr-only">
              Knowledge pages. Open a title to read its full body.
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Summary</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Pinned</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {pages.data.items.map((page) => {
                const updated = [page.userEditedAt, page.lastCompiledAt]
                  .filter((date): date is string => Boolean(date))
                  .sort()
                  .at(-1);
                return (
                  <tr key={page.id}>
                    <th scope="row">
                      <Link
                        to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}
                      >
                        {page.title}
                      </Link>
                    </th>
                    <td data-label="Summary">{page.summary || "No summary"}</td>
                    <td data-label="Type">{page.pageType}</td>
                    <td data-label="Status">
                      <span className={page.status === "contested" ? "disputed" : ""}>
                        {page.status === "contested" ? "Disputed · contested" : page.status}
                      </span>
                      {page.archived && page.status !== "archived" ? " · archived" : null}
                    </td>
                    <td data-label="Pinned">{page.pinned ? "Yes" : "No"}</td>
                    <td data-label="Updated">
                      {updated ? (
                        <time dateTime={updated}>{new Date(updated).toLocaleString()}</time>
                      ) : (
                        "Not available"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="help mt-3">
            Updated reflects the latest compile or user edit; opening a page does not change it.
          </p>
        </section>
      ) : null}
      {pages.data ? (
        <Pagination
          {...pages.data}
          pending={pages.isFetching}
          onChange={(next) => setParams(next ? { offset: String(next) } : {})}
        />
      ) : null}
    </>
  );
}
