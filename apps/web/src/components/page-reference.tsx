import { Link } from "react-router";
import { resolvePage } from "../lib/activity";
import type { Page } from "../lib/api";
import { StatusBadge } from "./status-badge";

export function PageReference({
  brainId,
  pageId,
  pages,
}: {
  brainId: string;
  pageId: string;
  pages: readonly Page[];
}) {
  const page = resolvePage(pages, pageId);
  if (!page) return <span>{pageId}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {page.slug ? (
        <Link
          to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}
          className="font-medium"
        >
          {page.title}
        </Link>
      ) : (
        <span className="font-medium">{page.title}</span>
      )}
      {page.status === "contested" ? <StatusBadge status="contested" className="disputed" /> : null}
    </span>
  );
}
