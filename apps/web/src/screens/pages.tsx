import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import type { IndexEntry, Page, PageStatus } from "../lib/api";
import { useApi } from "../lib/api-context";
import { exportFilename } from "../lib/export";
import {
  indexDispute,
  listSearchParams,
  pageStatuses,
  parseOffset,
  parsePageStatus,
} from "../lib/list-params";

const pageSize = 50;
const indexLimit = 200;

interface DisplayRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  pinned: boolean;
  archived: boolean;
  updated: string | null;
  dispute: PageStatus | "clear" | "unknown" | "checking";
}

function usableTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time <= 0) return null;
  return value;
}

function pageUpdated(page: Page): string | null {
  return usableTime(
    [page.userEditedAt, page.lastCompiledAt]
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1),
  );
}

function statusText(dispute: DisplayRow["dispute"]): string {
  if (dispute === "contested") return "Disputed · contested";
  if (dispute === "checking") return "Checking disputes…";
  if (dispute === "unknown") return "Status unavailable";
  if (dispute === "clear") return "Not contested";
  return dispute;
}

function PageTable({ brainId, rows }: { brainId: string; rows: readonly DisplayRow[] }) {
  return (
    <section className="panel" aria-label="Pages">
      <table className="pages-table">
        <caption className="sr-only">Knowledge pages. Open a title to read its full body.</caption>
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
                >
                  {page.title}
                </Link>
              </th>
              <td data-label="Summary">{page.summary || "No summary"}</td>
              <td data-label="Type">{page.pageType}</td>
              <td data-label="Status">
                <span className={page.dispute === "contested" ? "disputed" : ""}>
                  {statusText(page.dispute)}
                </span>
                {page.archived && page.dispute !== "archived" ? " · archived" : null}
              </td>
              <td data-label="Pinned">{page.pinned ? "Yes" : "No"}</td>
              <td data-label="Updated">
                {page.updated ? (
                  <time dateTime={page.updated}>{new Date(page.updated).toLocaleString()}</time>
                ) : (
                  "Not available"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function indexRows(
  items: readonly IndexEntry[],
  offset: number,
  contestedSlugs: readonly string[],
  labels: "checking" | "unknown" | "ready",
): DisplayRow[] {
  return items.slice(offset, offset + pageSize).map((page) => ({
    id: page.slug,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    pageType: page.pageType,
    pinned: page.pinned,
    archived: false,
    updated: usableTime(page.updatedAt),
    dispute: labels === "ready" ? indexDispute(page.slug, contestedSlugs, true) : labels,
  }));
}

function filteredRows(items: readonly Page[]): DisplayRow[] {
  return items.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    pageType: page.pageType,
    pinned: page.pinned,
    archived: page.archived,
    updated: pageUpdated(page),
    dispute: page.status,
  }));
}

export function Pages() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const offset = parseOffset(params.get("offset"));
  const status = parsePageStatus(params.get("status"));
  const index = useQuery({
    queryKey: ["index", brainId, { limit: indexLimit }],
    queryFn: () => api.getIndex(brainId, { limit: indexLimit }),
    enabled: !status,
  });
  const contested = useQuery({
    queryKey: ["pages", brainId, { limit: indexLimit, offset: 0, status: "contested" }],
    queryFn: () => api.listPages(brainId, { limit: indexLimit, offset: 0, status: "contested" }),
    enabled: !status,
  });
  const filtered = useQuery({
    queryKey: [
      "pages",
      brainId,
      status ? { limit: pageSize, offset, status } : { limit: pageSize, offset, view: "idle" },
    ],
    queryFn: () =>
      api.listPages(
        brainId,
        status ? { limit: pageSize, offset, status } : { limit: pageSize, offset },
      ),
    enabled: Boolean(status),
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
  const active = status ? filtered : index;
  const contestedSlugs = contested.data?.items.map((page) => page.slug) ?? [];
  const contestedComplete = contested.data
    ? contested.data.items.length >= contested.data.total
    : false;
  const labels = contested.isPending
    ? "checking"
    : contested.isError || !contestedComplete
      ? "unknown"
      : "ready";
  const rows = status
    ? filteredRows(filtered.data?.items ?? [])
    : indexRows(index.data?.items ?? [], offset, contestedSlugs, labels);
  const pageableTotal = status ? (filtered.data?.total ?? 0) : (index.data?.items.length ?? 0);
  const indexTruncated = !status && index.data ? index.data.total > index.data.items.length : false;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1>Pages</h1>
        <button type="button" disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? "Exporting…" : "Download export"}
        </button>
      </div>
      <div>
        <label htmlFor="page-status">Status</label>
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
        <ErrorBanner error={active.error ?? download.error} />
        {download.isSuccess ? <p className="help">Export downloaded.</p> : null}
        {!status && contested.isError ? (
          <p className="help" role="status">
            Contested pages could not be checked, so their dispute status is unavailable.
          </p>
        ) : null}
        {indexTruncated ? (
          <p className="help" role="status">
            Showing the first {index.data?.items.length} of {index.data?.total}. The index has no
            offset parameter, so later pages are unavailable. Filter by status to page through one
            status.
          </p>
        ) : null}
        {!status && contested.data && !contestedComplete ? (
          <p className="help" role="status">
            The contested list is longer than {indexLimit}, so dispute labels are hidden. Filter by
            contested to review them.
          </p>
        ) : null}
      </div>
      {active.isPending ? <Loading label="Loading pages" /> : null}
      {active.data && rows.length === 0 ? (
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
              <button type="button" onClick={() => setParams(listSearchParams(undefined, 0))}>
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
          {status
            ? "Updated reflects the latest compile or user edit. Opening a page does not change it."
            : "The unfiltered list is the brain index, which has no page bodies. Updated is the latest compile, or the last reference when a page has not been compiled."}
        </p>
      ) : null}
      {active.data ? (
        <Pagination
          total={pageableTotal}
          limit={pageSize}
          offset={offset}
          pending={active.isFetching}
          onChange={(next) => setParams(listSearchParams(status, next))}
        />
      ) : null}
    </>
  );
}
