import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { useApi } from "../lib/api-context";
import { ErrorBanner } from "./feedback";

export function Layout({ onDisconnect }: { onDisconnect: () => void }) {
  const { brainId } = useParams();
  const api = useApi();
  const brain = useQuery({
    queryKey: ["brain", brainId, {}],
    queryFn: () => api.getBrain(brainId ?? ""),
    enabled: Boolean(brainId),
  });
  const base = `/brains/${encodeURIComponent(brainId ?? "")}`;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <Link to="/" className="font-semibold text-slate-950">
              Memtavi <span className="font-normal text-slate-500">/ Inspector</span>
            </Link>
            {brainId ? (
              <p className="mt-1 break-words text-sm text-slate-600">
                {brain.data?.name ?? (brain.isPending ? "Loading brain…" : brainId)}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onDisconnect}>
            Connection settings
          </button>
        </div>
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 pb-4 sm:px-6"
        >
          <NavLink to="/" end>
            Brains
          </NavLink>
          {brainId ? (
            <>
              <NavLink to={`${base}/pages`}>Pages</NavLink>
              <NavLink to={`${base}/search`}>Search</NavLink>
            </>
          ) : null}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <ErrorBanner error={brain.error} />
        <Outlet />
      </main>
    </>
  );
}
