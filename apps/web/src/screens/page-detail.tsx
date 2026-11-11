import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router";
import remarkGfm from "remark-gfm";
import { ErrorBanner, Loading, Pagination } from "../components/feedback";
import { StatusBadge } from "../components/status-badge";
import { ApiError, type Page, type PageUpdate, type PageVersionDiff } from "../lib/api";
import { useApi } from "../lib/api-context";
import { diffRows, orderedVersions } from "../lib/diff-model";
import { formatDate, formatDateTime, formatRelative } from "../lib/format";
import { applyCacheEffect } from "../lib/invalidation";
import { buildPageUpdate, type PageFields } from "../lib/page-update";

function PageMetadataEntries({ data }: { data: Page }) {
  const metadata: [string, React.ReactNode][] = [
    [
      "Type",
      <span key="type" className="badge badge-neutral">
        {data.pageType}
      </span>,
    ],
    ["Status", <StatusBadge key="status" status={data.status} />],
    ["Bucket", data.bucket],
    ["Bucket source", data.bucketSource],
    ["Pinned", data.pinned ? "Yes" : "No"],
    ["Archived", data.archived ? "Yes" : "No"],
    ["Version", String(data.version)],
    ["Deletion state", data.deletionState],
    [
      "Last compiled",
      data.lastCompiledAt ? (
        <time
          key="compiled"
          dateTime={data.lastCompiledAt}
          title={formatDateTime(data.lastCompiledAt)}
        >
          {formatDate(data.lastCompiledAt)}
        </time>
      ) : (
        "Not available"
      ),
    ],
    [
      "Last referenced",
      data.lastReferencedAt ? (
        <time
          key="referenced"
          dateTime={data.lastReferencedAt}
          title={formatDateTime(data.lastReferencedAt)}
        >
          {formatDate(data.lastReferencedAt)}
        </time>
      ) : (
        "Not available"
      ),
    ],
    [
      "User edited",
      data.userEditedAt ? (
        <time
          key="user-edited"
          dateTime={data.userEditedAt}
          title={formatDateTime(data.userEditedAt)}
        >
          {formatDate(data.userEditedAt)}
        </time>
      ) : (
        "Not available"
      ),
    ],
    ["Embedding model", data.embeddingModel ?? "None"],
    ["Entities", data.entities.join(", ") || "None"],
    ["Backlinks", data.backlinks.join(", ") || "None"],
  ];

  return (
    <>
      {metadata.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-sm text-slate-900">{value}</dd>
        </div>
      ))}
    </>
  );
}

function PageContent({
  data,
  brainId,
  slug,
  reload,
  reloading,
}: {
  data: Page;
  brainId: string;
  slug: string;
  reload: () => Promise<boolean>;
  reloading: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<{
    original: PageFields & Pick<Page, "version">;
    edited: PageFields;
  } | null>(null);
  const update = useMutation({
    mutationFn: (input: PageUpdate) => api.updatePage(brainId, slug, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["page", brainId, { slug }], updated);
      setDraft(null);
      await applyCacheEffect(queryClient, "updatePage", { brainId, slug });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deletePage(brainId, slug),
    onSuccess: async () => {
      await applyCacheEffect(queryClient, "deletePage", { brainId, slug });
      navigate(`/brains/${encodeURIComponent(brainId)}/pages`);
    },
  });
  const conflict = update.error instanceof ApiError && update.error.status === 409;
  const changes = draft ? buildPageUpdate(draft.original, draft.edited) : null;
  const busy = update.isPending || reloading;

  return (
    <article className="space-y-6">
      {/* Lead with title, badges, and summary */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={data.status} />
          <span className="badge badge-neutral">{data.pageType}</span>
          {data.pinned ? <span className="badge badge-info">Pinned</span> : null}
          {data.archived ? <span className="badge badge-neutral">Archived</span> : null}
        </div>
        <h1 className="break-words">{data.title}</h1>
        {data.summary ? (
          <p className="break-words text-base text-slate-600 sm:text-lg">{data.summary}</p>
        ) : (
          <p className="italic text-slate-400">No summary</p>
        )}
      </div>

      <div aria-live="polite" aria-atomic="true">
        {conflict ? (
          <div className="error-banner space-y-3">
            <p>This page changed. Reload the latest version.</p>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy}
              onClick={async () => {
                if (await reload()) {
                  setDraft(null);
                  update.reset();
                }
              }}
            >
              {reloading ? "Reloading…" : "Reload latest version"}
            </button>
          </div>
        ) : (
          <ErrorBanner error={update.error} />
        )}
      </div>

      {data.status === "contested" ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
          <p role="status" className="text-sm text-amber-950">
            <strong className="font-semibold">Disputed:</strong> this page contains unresolved
            claims.
          </p>
          <div>
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/conflicts`}
              className="font-medium text-amber-900 underline hover:text-amber-950"
            >
              Resolve this disputed page →
            </Link>
          </div>
        </div>
      ) : null}

      {draft ? (
        <form
          className="panel space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (changes && Object.keys(changes).length > 1 && !busy && !conflict) {
              update.mutate(changes);
            }
          }}
        >
          <h2>Edit page</h2>
          <fieldset disabled={busy || conflict} className="min-w-0 space-y-5">
            <legend className="sr-only">Page content</legend>
            <div>
              <label htmlFor="page-title">Title</label>
              <input
                id="page-title"
                required
                value={draft.edited.title}
                onChange={(event) =>
                  setDraft({ ...draft, edited: { ...draft.edited, title: event.target.value } })
                }
              />
            </div>
            <div>
              <label htmlFor="page-summary">Summary</label>
              <textarea
                id="page-summary"
                rows={3}
                value={draft.edited.summary}
                onChange={(event) =>
                  setDraft({ ...draft, edited: { ...draft.edited, summary: event.target.value } })
                }
              />
            </div>
            <div>
              <label htmlFor="page-body">Body (Markdown)</label>
              <textarea
                id="page-body"
                className="font-mono text-sm"
                rows={16}
                value={draft.edited.body}
                onChange={(event) =>
                  setDraft({ ...draft, edited: { ...draft.edited, body: event.target.value } })
                }
              />
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-primary"
              type="submit"
              disabled={busy || conflict || !changes || Object.keys(changes).length === 1}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                if (!conflict) update.reset();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={busy || conflict}
            onClick={() => {
              update.reset();
              const fields = { title: data.title, summary: data.summary, body: data.body };
              setDraft({ original: { ...fields, version: data.version }, edited: fields });
            }}
          >
            Edit page
          </button>
        </div>
      )}

      {/* Main body with desktop right-hand aside layout */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start">
        <div className="space-y-6 lg:col-span-8">
          <aside
            className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs sm:text-sm text-amber-950"
            aria-label="Evidence status"
          >
            <strong>Unsupported claims.</strong> This API response does not include claim evidence
            or source spans. The body below cannot be verified from this inspector yet.
          </aside>

          <section className="panel markdown min-w-0" aria-label="Page body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{ img: ({ alt }) => <span>[Image: {alt || "unlabelled"}]</span> }}
            >
              {data.body}
            </ReactMarkdown>
          </section>

          {/* Phone only: metadata details disclosure after the body */}
          <details className="panel lg:hidden" aria-label="Page details">
            <summary className="cursor-pointer font-semibold text-slate-900">Page details</summary>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <PageMetadataEntries data={data} />
            </dl>
          </details>
        </div>

        {/* Desktop only: right-hand aside */}
        <aside className="hidden lg:col-span-4 lg:block panel space-y-4" aria-label="Page details">
          <h2 className="section-title">Page details</h2>
          <dl className="space-y-3.5 text-sm">
            <PageMetadataEntries data={data} />
          </dl>
        </aside>
      </div>

      <Versions brainId={brainId} slug={slug} currentVersion={data.version} />

      <section className="panel space-y-3" aria-labelledby="delete-page-heading">
        <h2 id="delete-page-heading">Delete this page</h2>
        <p className="text-sm text-slate-600">
          Deleting a page removes its versions, evidence links, embeddings, briefs and connections.
          Sources are kept.
        </p>
        {confirmingDelete ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
            <p className="font-medium text-red-900">
              Permanently delete “{data.title}”? This cannot be undone.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? "Deleting…" : `Permanently delete ${data.title}`}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={remove.isPending}
                onClick={() => {
                  setConfirmingDelete(false);
                  remove.reset();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-danger text-xs"
            disabled={busy || remove.isPending}
            onClick={() => setConfirmingDelete(true)}
          >
            Permanently delete page
          </button>
        )}
        <div aria-live="polite" aria-atomic="true">
          <ErrorBanner error={remove.error} />
        </div>
      </section>
    </article>
  );
}

function FieldDiff({ name, field }: { name: string; field: { from: string; to: string } }) {
  if (field.from === field.to)
    return (
      <p className="text-sm text-slate-600">
        <span className="font-semibold text-slate-700">{name}:</span> {field.from || "Empty"}
      </p>
    );
  return (
    <div className="space-y-1.5 text-sm">
      <p className="rounded-md bg-red-50 p-2 text-red-950 border border-red-200">
        <span className="font-semibold">removed</span> {name}: {field.from || "Empty"}
      </p>
      <p className="rounded-md bg-emerald-50 p-2 text-emerald-950 border border-emerald-200">
        <span className="font-semibold">added</span> {name}: {field.to || "Empty"}
      </p>
    </div>
  );
}

function DiffView({ diff }: { diff: PageVersionDiff }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldDiff name="Title" field={diff.title} />
        <FieldDiff name="Summary" field={diff.summary} />
      </div>
      {diff.hunks.length === 0 ? (
        <p className="text-sm text-slate-500">No body lines changed.</p>
      ) : null}
      <ol className="space-y-3" aria-label="Diff hunks">
        {diff.hunks.map((hunk) => (
          <li
            key={`${hunk.oldStart}:${hunk.newStart}:${hunk.oldLines}:${hunk.newLines}`}
            className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <p className="font-mono text-xs text-slate-500">
              Hunk at old line {hunk.oldStart}, new line {hunk.newStart}
            </p>
            <ol className="overflow-x-auto rounded border border-slate-200 bg-white font-mono text-xs">
              {diffRows(hunk.lines).map((row) => (
                <li
                  key={row.key}
                  className={`px-3 py-1 whitespace-pre-wrap break-words ${
                    row.op === "add"
                      ? "bg-emerald-50 text-emerald-950"
                      : row.op === "remove"
                        ? "bg-red-50 text-red-950"
                        : "text-slate-700"
                  }`}
                >
                  {row.op === "context" ? (
                    <span className="sr-only">unchanged: </span>
                  ) : (
                    <span className="font-semibold">
                      {row.label} {row.marker}{" "}
                    </span>
                  )}
                  {row.text || " "}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Versions({
  brainId,
  slug,
  currentVersion,
}: {
  brainId: string;
  slug: string;
  currentVersion: number;
}) {
  const api = useApi();
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pair, setPair] = useState<{ from: number; to: number } | null>(null);
  const versionParams = { slug, limit: 20, offset };
  const versions = useQuery({
    queryKey: ["page-versions", brainId, versionParams],
    queryFn: () => api.listPageVersions(brainId, slug, { limit: 20, offset }),
  });
  const viewed = useQuery({
    queryKey: ["page-version", brainId, { slug, version: version ?? 0 }],
    queryFn: () => api.getPageVersion(brainId, slug, version ?? 0),
    enabled: version !== null,
  });
  const comparable = pair !== null && orderedVersions(pair.from, pair.to);
  const diff = useQuery({
    queryKey: ["page-diff", brainId, { slug, from: pair?.from ?? 0, to: pair?.to ?? 0 }],
    queryFn: () =>
      api.diffPageVersions(
        brainId,
        slug,
        pair ? { from: pair.from, to: pair.to } : { from: 1, to: 2 },
      ),
    enabled: comparable,
  });
  const fromNumber = Number(from);
  const toNumber = Number(to);
  const canCompare = orderedVersions(fromNumber, toNumber);

  return (
    <section className="panel space-y-6" aria-labelledby="versions-heading">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 id="versions-heading">Versions and Diff</h2>
          <p className="mt-1 text-sm text-slate-600">Inspect version history and compare diffs.</p>
        </div>
      </div>
      <ErrorBanner error={versions.error} />
      {versions.isPending ? <Loading label="Loading versions" /> : null}
      {versions.data?.items.length === 0 ? <p>No versions are recorded for this page.</p> : null}

      {/* Two-column layout on desktop that stacks on a phone */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Column 1: Version History */}
        <div className="space-y-4">
          <h3 className="section-title">Version history</h3>
          {versions.data && versions.data.items.length > 0 ? (
            <ul className="space-y-3">
              {versions.data.items.map((item) => (
                <li
                  key={item.version}
                  className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">Version {item.version}</span>
                      {item.version === currentVersion ? (
                        <span className="badge badge-info">Current</span>
                      ) : null}
                    </div>
                    <span className="meta">{item.actor}</span>
                  </div>
                  <p className="font-medium text-slate-800">{item.title}</p>
                  <p className="text-xs text-slate-600">{item.summary || "No summary"}</p>
                  <time
                    className="block text-xs text-slate-500"
                    dateTime={item.createdAt}
                    title={formatDateTime(item.createdAt)}
                  >
                    {formatRelative(item.createdAt)}
                  </time>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setVersion(version === item.version ? null : item.version)}
                  >
                    {version === item.version
                      ? `Hide version ${item.version}`
                      : `View version ${item.version}`}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {versions.data ? (
            <Pagination {...versions.data} pending={versions.isFetching} onChange={setOffset} />
          ) : null}

          {version !== null ? (
            <div aria-live="polite" className="mt-4 space-y-3 border-t border-slate-200 pt-4">
              <ErrorBanner error={viewed.error} />
              {viewed.isPending ? <Loading label={`Loading version ${version}`} /> : null}
              {viewed.data ? (
                <article
                  className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
                  aria-label={`Version ${viewed.data.version}`}
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-slate-900">Version {viewed.data.version}</h4>
                    <span className="badge badge-neutral">Snapshot</span>
                  </div>
                  <p className="font-medium text-slate-900">{viewed.data.title}</p>
                  <p className="text-sm text-slate-600">{viewed.data.summary || "No summary"}</p>
                  <div className="markdown min-w-0 border-t border-slate-200 pt-3 text-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      skipHtml
                      components={{ img: ({ alt }) => <span>[Image: {alt || "unlabelled"}]</span> }}
                    >
                      {viewed.data.body}
                    </ReactMarkdown>
                  </div>
                </article>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Column 2: Compare & Diff */}
        <div className="space-y-4">
          <h3 className="section-title">Compare two versions</h3>
          <form
            className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canCompare) return;
              setPair({ from: fromNumber, to: toNumber });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="diff-from">From (older version)</label>
                <input
                  id="diff-from"
                  type="number"
                  min={1}
                  step={1}
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="diff-to">To (newer version)</label>
                <input
                  id="diff-to"
                  type="number"
                  min={1}
                  step={1}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </div>
            </div>
            {from && to && !canCompare ? (
              <p role="status" className="text-xs text-amber-800">
                The older version must be the From version.
              </p>
            ) : null}
            <button className="btn-primary text-xs" type="submit" disabled={!canCompare}>
              Compare versions
            </button>
          </form>

          {pair ? (
            <div aria-live="polite" className="space-y-3">
              <ErrorBanner error={diff.error} />
              {diff.isPending ? <Loading label="Loading diff" /> : null}
              {diff.data ? <DiffView diff={diff.data} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function PageDetail() {
  const api = useApi();
  const { brainId = "", slug = "" } = useParams();
  const page = useQuery({
    queryKey: ["page", brainId, { slug }],
    queryFn: () => api.getPage(brainId, slug),
    refetchOnMount: "always",
  });
  const data = page.data;

  return (
    <>
      <div className="mb-2">
        <Link
          to={`/brains/${encodeURIComponent(brainId)}/pages`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-700"
        >
          ← Back to pages
        </Link>
      </div>
      <ErrorBanner error={page.error} />
      {page.isPending ? <Loading label="Loading page" /> : null}
      {data ? (
        <PageContent
          key={`${brainId}/${slug}`}
          data={data}
          brainId={brainId}
          slug={slug}
          reload={async () => !(await page.refetch()).isError}
          reloading={page.isFetching}
        />
      ) : null}
    </>
  );
}
