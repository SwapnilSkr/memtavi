import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router";
import remarkGfm from "remark-gfm";
import { ErrorBanner, Loading } from "../components/feedback";
import { useApi } from "../lib/api-context";

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
        <article className="space-y-6">
          <div>
            <h1 className="break-words">{data.title}</h1>
            <p className="mt-3 text-slate-600">{data.summary}</p>
          </div>
          {data.status === "contested" ? (
            <p className="disputed" role="status">
              Disputed · contested: this page contains unresolved claims.
            </p>
          ) : null}
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
        </article>
      ) : null}
    </>
  );
}
