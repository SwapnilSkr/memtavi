import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import { StatusBadge } from "../components/status-badge";
import type { IndexEntry, PageStatus } from "../lib/api";
import { useApi } from "../lib/api-context";
import { exportFilename } from "../lib/export";
import { formatDateTime, formatRelative } from "../lib/format";
import { listSearchParams, pageStatuses, parseOffset, parsePageStatus } from "../lib/list-params";

const pageSize = 50;

interface DisplayRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  pinned: boolean;
  updated: string | null;
  dispute: PageStatus | "unknown";
}

function usableTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time <= 0) return null;
  return value;
}

function PageTable({ brainId, rows }: { brainId: string; rows: readonly DisplayRow[] }) {
  return (
    <section className="panel" aria-label="Pages">
      {/* Desktop / tablet table (>= 768px) */}
      <div className="hidden overflow-x-auto md:block">
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
            {rows.map((page) => (
              <tr key={page.id}>
                <th scope="row">
                  <Link
                    to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}
                    className="font-medium text-slate-900 hover:text-indigo-700"
                  >
                    {page.title}
                  </Link>
                </th>
                <td className="max-w-md truncate text-slate-600">{page.summary || "No summary"}</td>
                <td>
                  <span className="badge badge-neutral">{page.pageType}</span>
                </td>
                <td>
                  <StatusBadge status={page.dispute} />
                </td>
                <td>
                  {page.pinned ? (
                    <span className="badge badge-info">Pinned</span>
                  ) : (
                    <span className="text-xs text-slate-400">No</span>
                  )}
                </td>
                <td className="whitespace-nowrap text-slate-500">
                  {page.updated ? (
                    <time
                      dateTime={page.updated}
                      title={formatDateTime(page.updated)}
                      className="text-xs"
                    >
                      {formatRelative(page.updated)}
                    </time>
                  ) : (
                    <span className="text-xs text-slate-400">Not available</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone compact cards (< 768px) */}
      <ul className="space-y-3 md:hidden" aria-label="Knowledge pages list">
        {rows.map((page) => (
          <li
            key={page.id}
            className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}
                className="font-semibold text-slate-900 hover:text-indigo-700"
              >
                {page.title}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={page.dispute} />
                {page.pinned ? <span className="badge badge-info">Pinned</span> : null}
              </div>
            </div>
            {page.summary ? (
              <p className="line-clamp-2 text-sm text-slate-600">{page.summary}</p>
            ) : (
              <p className="text-sm italic text-slate-400">No summary</p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-600">{page.pageType}</span>
              <span aria-hidden="true">·</span>
              {page.updated ? (
                <time dateTime={page.updated} title={formatDateTime(page.updated)}>
                  {formatRelative(page.updated)}
                </time>
              ) : (
                <span>Not available</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function indexRows(items: readonly IndexEntry[]): DisplayRow[] {
  return items.map((page) => ({
    id: page.slug,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    pageType: page.pageType,
    pinned: page.pinned,
    updated: usableTime(page.updatedAt),
    dispute: page.status ?? "unknown",
  }));
}

export function Pages() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const offset = parseOffset(params.get("offset"));
  const status = parsePageStatus(params.get("status"));
  const listParams = { limit: pageSize, offset, ...(status ? { status } : {}) };
  const index = useQuery({
    queryKey: ["index", brainId, listParams],
    queryFn: () => api.getIndex(brainId, listParams),
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
  const rows = indexRows(index.data?.items ?? []);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1>Pages</h1>
          <p className="mt-1 text-sm text-slate-600">
            Browse and inspect pages compiled in this brain.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          {download.isPending ? "Exporting…" : "Download export"}
        </button>
      </div>

      <div className="max-w-xs">
        <label htmlFor="page-status">Filter by status</label>
        <select
          id="page-status"
          value={status ?? ""}
          onChange={(event) => {
            const next = parsePageStatus(event.target.value);
            setParams(listSearchParams(next, 0));
          }}
        >
          <option value="">All statuses</option>
          {pageStatuses.map((item) => (
            <option key={item} value={item}>
              {item === "contested" ? "contested (disputed)" : item}
            </option>
          ))}
        </select>
      </div>

      <div aria-live="polite" aria-atomic="true">
        <ErrorBanner error={index.error ?? download.error} />
        {download.isSuccess ? <p className="help">Export downloaded.</p> : null}
      </div>

      {index.isPending ? <Loading label="Loading pages" /> : null}

      {index.data && rows.length === 0 ? (
        <EmptyState>
          <div className="space-y-3">
            {offset > 0 ? (
              <p>No pages in this window.</p>
            ) : status ? (
              <p>No pages with status {status}.</p>
            ) : (
              <p>No pages in this index.</p>
            )}
            {status ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setParams(listSearchParams(undefined, 0))}
              >
                Show all statuses
              </button>
            ) : null}
            <p>
              <Link to={`/brains/${encodeURIComponent(brainId)}/capture`}>
                Capture a note or URL
              </Link>
              , <Link to={`/brains/${encodeURIComponent(brainId)}/search`}>Search this brain</Link>{" "}
              or <Link to="/">choose another brain</Link>.
            </p>
          </div>
        </EmptyState>
      ) : null}

      {rows.length > 0 ? <PageTable brainId={brainId} rows={rows} /> : null}

      {rows.length > 0 ? (
        <p className="help mt-3">
          The brain index contains no page bodies. Updated is the latest compile, or the last
          reference when a page has not been compiled.
        </p>
      ) : null}

      {index.data ? (
        <Pagination
          total={index.data.total}
          limit={index.data.limit}
          offset={index.data.offset}
          pending={index.isFetching}
          onChange={(next) => setParams(listSearchParams(status, next))}
        />
      ) : null}
    </>
  );
}
