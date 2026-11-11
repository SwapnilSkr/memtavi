import type React from "react";
import { Link } from "react-router";

export function ErrorBanner({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      {error.message}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4 py-6">
      <span className="sr-only">{label}</span>
      {[1, 2, 3].map((row) => (
        <div
          key={row}
          className="h-20 rounded-xl border border-slate-200 bg-slate-100 motion-safe:animate-pulse"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
  pending,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  pending: boolean;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={offset === 0 || pending}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={offset + limit >= total || pending}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
      <p aria-live="polite" className="meta">
        {total === 0 ? "0 results" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
      </p>
    </nav>
  );
}

export function NotFound() {
  return (
    <EmptyState>
      <h1 className="text-xl">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you requested could not be found.</p>
      <div className="mt-4">
        <Link to="/" className="btn-primary inline-flex text-sm">
          Go to brains
        </Link>
      </div>
    </EmptyState>
  );
}
