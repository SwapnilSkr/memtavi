import { Link } from "react-router";
import { resolvePage } from "../lib/activity";
import type { Page } from "../lib/api";

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
    <span>
      {page.slug ? (
        <Link to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}>
          {page.title}
        </Link>
      ) : (
        <span>{page.title}</span>
      )}
      {page.status === "contested" ? (
        <span className="disputed ml-2 inline-block">Disputed · contested</span>
      ) : null}
    </span>
  );
}
