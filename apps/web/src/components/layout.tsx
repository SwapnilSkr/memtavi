import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { useApi } from "../lib/api-context";
import { ErrorBanner } from "./feedback";

export function Layout({ onDisconnect }: { onDisconnect: () => void }) {
  const { brainId } = useParams();
  const api = useApi();
  const [lastBrainId, setLastBrainId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (brainId) setLastBrainId(brainId);
  }, [brainId]);

  const activeBrainId = brainId ?? lastBrainId;
  const brain = useQuery({
    queryKey: ["brain", brainId, {}],
    queryFn: () => api.getBrain(brainId ?? ""),
    enabled: Boolean(brainId),
  });

  const base = `/brains/${encodeURIComponent(brainId ?? "")}`;

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? "bg-indigo-50 text-indigo-900 font-semibold"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  const renderNavLinks = () => (
    <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-6">
      {brainId ? (
        <>
          <div>
            <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
              Knowledge
            </h3>
            <div className="mt-2 space-y-1">
              <NavLink
                to={`${base}/pages`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Pages
              </NavLink>
              <NavLink
                to={`${base}/search`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Search
              </NavLink>
              <NavLink
                to={`${base}/graph`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Graph
              </NavLink>
              <NavLink
                to={`${base}/connections`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Connections
              </NavLink>
              <NavLink
                to={`${base}/changes`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Changes
              </NavLink>
            </div>
          </div>

          <div>
            <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
              Review
            </h3>
            <div className="mt-2 space-y-1">
              <NavLink
                to={`${base}/conflicts`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Conflicts
              </NavLink>
              <NavLink
                to={`${base}/reviews`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Reviews
              </NavLink>
            </div>
          </div>

          <div>
            <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
              Brain
            </h3>
            <div className="mt-2 space-y-1">
              <NavLink
                to={`${base}/capture`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Capture
              </NavLink>
              <NavLink
                to={`${base}/health`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Health
              </NavLink>
              <NavLink
                to={`${base}/profile`}
                className={navItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Profile
              </NavLink>
            </div>
          </div>
        </>
      ) : null}

      <div className="mt-auto border-t border-slate-200 pt-4">
        <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
          Tenant
        </h3>
        <div className="mt-2 space-y-1">
          <NavLink to="/" end className={navItemClass} onClick={() => setMobileMenuOpen(false)}>
            Brains
          </NavLink>
          <NavLink to="/settings" className={navItemClass} onClick={() => setMobileMenuOpen(false)}>
            Settings
          </NavLink>
        </div>
        <div className="mt-4 px-3">
          <button type="button" onClick={onDisconnect} className="btn-secondary w-full text-xs">
            Connection settings
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {/* Desktop Left Sidebar (>= 1024px) */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white lg:p-6">
        <div className="mb-6">
          <Link to="/" className="text-lg font-bold tracking-tight text-slate-950">
            Memtavi <span className="font-normal text-slate-500">/ Inspector</span>
          </Link>
          {brainId ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="truncate text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Current Brain
              </p>
              <p
                className="mt-1 truncate font-medium text-slate-900"
                title={brain.data?.name ?? brainId}
              >
                {brain.data?.name ?? (brain.isPending ? "Loading brain…" : brainId)}
              </p>
              <Link
                to="/"
                className="mt-2 inline-block text-xs font-medium text-indigo-700 hover:underline"
              >
                ← Switch brain
              </Link>
            </div>
          ) : null}
        </div>
        {renderNavLinks()}
      </aside>

      {/* Phone Top Bar (< 1024px) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <Link to="/" className="text-base font-bold tracking-tight text-slate-950">
              Memtavi <span className="font-normal text-slate-500">/ Inspector</span>
            </Link>
            {brainId ? (
              <p className="max-w-[200px] truncate text-xs text-slate-600 sm:max-w-xs">
                {brain.data?.name ?? (brain.isPending ? "Loading brain…" : brainId)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>

        {mobileMenuOpen ? (
          <div
            id="mobile-navigation"
            className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-slate-200 bg-white p-4 shadow-lg"
          >
            {brainId ? (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Current Brain
                </p>
                <p className="mt-1 font-medium text-slate-900">
                  {brain.data?.name ?? (brain.isPending ? "Loading brain…" : brainId)}
                </p>
                <Link
                  to="/"
                  className="mt-2 inline-block text-xs font-medium text-indigo-700 hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  ← Switch brain
                </Link>
              </div>
            ) : null}
            {renderNavLinks()}
          </div>
        ) : null}
      </header>

      {/* Main Content */}
      <main id="main" className="lg:pl-64">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
          <ErrorBanner error={brain.error} />
          <Outlet context={{ activeBrainId }} />
        </div>
      </main>
    </div>
  );
}
