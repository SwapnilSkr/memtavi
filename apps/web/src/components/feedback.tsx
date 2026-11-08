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
          className="skeleton h-20 rounded-lg bg-slate-200 motion-safe:animate-pulse"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="panel py-10 text-center text-slate-600">{children}</div>;
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
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3 py-4">
      <button
        type="button"
        disabled={offset === 0 || pending}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <p aria-live="polite">
        {total === 0 ? "0 results" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
      </p>
      <button
        type="button"
        disabled={offset + limit >= total || pending}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </button>
    </nav>
  );
}

export function NotFound() {
  return (
    <EmptyState>
      <h1>Page not found</h1>
      <Link to="/">Go to brains</Link>
    </EmptyState>
  );
}
