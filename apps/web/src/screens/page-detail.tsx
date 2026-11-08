import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router";
import remarkGfm from "remark-gfm";
import { ErrorBanner, Loading } from "../components/feedback";
import { ApiError, type Page, type PageUpdate } from "../lib/api";
import { useApi } from "../lib/api-context";
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
  const [draft, setDraft] = useState<{
    original: PageFields & Pick<Page, "version">;
    edited: PageFields;
  } | null>(null);
  const update = useMutation({
    mutationFn: (input: PageUpdate) => api.updatePage(brainId, slug, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["page", brainId, { slug }], updated);
      setDraft(null);
      await Promise.all(
        queryClient
          .getQueryCache()
          .findAll()
          .filter(
            (query) =>
              query.queryKey[1] === brainId &&
              (query.queryKey[0] === "pages" || query.queryKey[0] === "search"),
          )
          .map((query) => queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true })),
      );
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
          <button
            type="button"
            disabled={busy || draft !== null || conflict}
            onClick={() => update.mutate({ status: "active", version: data.version })}
          >
            {update.isPending ? "Resolving…" : "Resolve"}
          </button>
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
    </article>
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
