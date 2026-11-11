import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router";
import remarkGfm from "remark-gfm";
import { ErrorBanner, Loading, Pagination } from "../components/feedback";
import { ApiError, type Page, type PageUpdate, type PageVersionDiff } from "../lib/api";
import { useApi } from "../lib/api-context";
import { diffRows, orderedVersions } from "../lib/diff-model";
import { applyCacheEffect } from "../lib/invalidation";
import { buildPageUpdate, type PageFields } from "../lib/page-update";

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
      <div>
        <h1 className="break-words">{data.title}</h1>
        <p className="mt-3 break-words text-slate-600">{data.summary}</p>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {conflict ? (
          <div className="error-banner space-y-3">
            <p>This page changed. Reload the latest version.</p>
            <button
              type="button"
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
        <div className="space-y-3">
          <p className="disputed" role="status">
            Disputed · contested: this page contains unresolved claims.
          </p>
          <Link to={`/brains/${encodeURIComponent(brainId)}/conflicts`}>
            Resolve this disputed page
          </Link>
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
              className="primary"
              type="submit"
              disabled={busy || conflict || !changes || Object.keys(changes).length === 1}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
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
        <button
          type="button"
          disabled={busy || conflict}
          onClick={() => {
            update.reset();
            const fields = { title: data.title, summary: data.summary, body: data.body };
            setDraft({ original: { ...fields, version: data.version }, edited: fields });
          }}
        >
          Edit
        </button>
      )}
      <dl className="panel grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        {Object.entries({
          Type: data.pageType,
          Status: data.status,
          Bucket: data.bucket,
          "Bucket source": data.bucketSource,
          Pinned: data.pinned ? "Yes" : "No",
          Archived: data.archived ? "Yes" : "No",
          Version: String(data.version),
          "Deletion state": data.deletionState,
          "Last compiled": data.lastCompiledAt ?? "Not available",
          "Last referenced": data.lastReferencedAt ?? "Not available",
          "User edited": data.userEditedAt ?? "Not available",
          "Embedding model": data.embeddingModel ?? "None",
          Entities: data.entities.join(", ") || "None",
          Backlinks: data.backlinks.join(", ") || "None",
        }).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="font-semibold text-slate-500">{label}</dt>
            <dd className="mt-1 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <aside
        className="rounded-lg border border-amber-300 bg-amber-50 p-4"
        aria-label="Evidence status"
      >
        <strong>Unsupported claims.</strong> This API response does not include claim evidence or
        source spans. The body below cannot be verified from this inspector yet.
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
      <Versions brainId={brainId} slug={slug} currentVersion={data.version} />
      <section className="panel space-y-3" aria-labelledby="delete-page-heading">
        <h2 id="delete-page-heading">Delete this page</h2>
        <p className="text-slate-600">
          Deleting a page removes its versions, evidence links, embeddings, briefs and connections.
          Sources are kept.
        </p>
        {confirmingDelete ? (
          <>
            <p>Permanently delete “{data.title}”? This cannot be undone.</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="border-red-300 bg-red-50 text-red-900 hover:bg-red-100"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? "Deleting…" : `Permanently delete ${data.title}`}
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  setConfirmingDelete(false);
                  remove.reset();
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="border-red-300 bg-red-50 text-red-900 hover:bg-red-100"
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
      <p>
        {name}: {field.from || "Empty"}
      </p>
    );
  return (
    <div className="space-y-2">
      <p>
        <span className="font-semibold">removed</span> {name}: {field.from || "Empty"}
      </p>
      <p>
        <span className="font-semibold">added</span> {name}: {field.to || "Empty"}
      </p>
    </div>
  );
}

function DiffView({ diff }: { diff: PageVersionDiff }) {
  return (
    <div className="space-y-4">
      <FieldDiff name="Title" field={diff.title} />
      <FieldDiff name="Summary" field={diff.summary} />
      {diff.hunks.length === 0 ? <p>No body lines changed.</p> : null}
      <ol className="space-y-4" aria-label="Diff hunks">
        {diff.hunks.map((hunk) => (
          <li
            key={`${hunk.oldStart}:${hunk.newStart}:${hunk.oldLines}:${hunk.newLines}`}
            className="space-y-1"
          >
            <p className="text-sm text-slate-600">
              Hunk at old line {hunk.oldStart}, new line {hunk.newStart}
            </p>
            <ol className="space-y-1">
              {diffRows(hunk.lines).map((row) => (
                <li
                  key={row.key}
                  className={`whitespace-pre-wrap break-words font-mono text-sm ${
                    row.op === "add"
                      ? "bg-green-50 text-green-950"
                      : row.op === "remove"
                        ? "bg-red-50 text-red-950"
                        : ""
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
    <section className="panel space-y-4" aria-labelledby="versions-heading">
      <h2 id="versions-heading">Versions</h2>
      <ErrorBanner error={versions.error} />
      {versions.isPending ? <Loading label="Loading versions" /> : null}
      {versions.data?.items.length === 0 ? <p>No versions are recorded for this page.</p> : null}
      {versions.data && versions.data.items.length > 0 ? (
        <ul className="space-y-3">
          {versions.data.items.map((item) => (
            <li key={item.version} className="space-y-2 border-b border-slate-200 pb-3">
              <p className="break-words">
                Version {item.version}
                {item.version === currentVersion ? " · current" : ""} · {item.actor}
              </p>
              <p className="break-words text-slate-600">{item.title}</p>
              <p className="break-words text-sm text-slate-600">{item.summary || "No summary"}</p>
              <time className="block text-sm text-slate-600" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
              <button
                type="button"
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
        <div aria-live="polite" className="space-y-3">
          <ErrorBanner error={viewed.error} />
          {viewed.isPending ? <Loading label={`Loading version ${version}`} /> : null}
          {viewed.data ? (
            <article className="space-y-3" aria-label={`Version ${viewed.data.version}`}>
              <h3>Version {viewed.data.version}</h3>
              <p className="break-words">{viewed.data.title}</p>
              <p className="break-words text-slate-600">{viewed.data.summary || "No summary"}</p>
              <div className="markdown min-w-0">
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
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canCompare) return;
          setPair({ from: fromNumber, to: toNumber });
        }}
      >
        <h3>Compare two versions</h3>
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
          <p role="status">The older version must be the From version.</p>
        ) : null}
        <button className="primary" type="submit" disabled={!canCompare}>
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
      <Link to={`/brains/${encodeURIComponent(brainId)}/pages`}>← Back to pages</Link>
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
