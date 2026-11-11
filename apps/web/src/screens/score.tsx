import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { StatusBadge } from "../components/status-badge";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { formatDateTime, formatRelative } from "../lib/format";
import { healthMetrics, historyToPoints, scoreValue, suggestionRoute } from "../lib/health";

export function ScoreScreen() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const score = useQuery({
    queryKey: ["score", brainId, {}],
    queryFn: async () => {
      try {
        return await api.getScore(brainId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const history = useQuery({
    queryKey: ["score-history", brainId, { range: "30d" }],
    queryFn: () => api.getScoreHistory(brainId, "30d"),
  });
  const suggestions = useQuery({
    queryKey: ["score-suggestions", brainId, {}],
    queryFn: () => api.getScoreSuggestions(brainId),
  });
  const points = history.data ? historyToPoints(history.data) : [];
  const data = score.data;
  const refreshing = score.isFetching || history.isFetching || suggestions.isFetching;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1>Brain health</h1>
          <p className="mt-1 text-slate-600">
            Scores range from 0 to 100. Higher freshness and readiness are better. Lower strain is
            better.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={refreshing}
          onClick={() => {
            void score.refetch();
            void history.refetch();
            void suggestions.refetch();
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh health"}
        </button>
      </div>

      <ErrorBanner error={score.error} />
      {score.isPending ? <Loading label="Loading health score" /> : null}

      {data === null ? (
        <EmptyState>
          <p>
            No snapshot yet.{" "}
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/capture`}
              className="font-semibold text-indigo-700 hover:underline"
            >
              Capture knowledge
            </Link>
            , then refresh health.
          </p>
        </EmptyState>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <p className="text-xs text-slate-500">
            Computed{" "}
            <time dateTime={data.computedAt} title={formatDateTime(data.computedAt)}>
              {formatRelative(data.computedAt)}
            </time>
          </p>

          {/* Three metric cards with 0-100 value large and factor list under each */}
          <div className="grid gap-6 md:grid-cols-3">
            {healthMetrics.map((metric) => {
              const value = scoreValue(data[metric]);
              return (
                <section
                  className="panel flex flex-col justify-between space-y-4"
                  key={metric}
                  aria-labelledby={`score-${metric}`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h2
                        id={`score-${metric}`}
                        className="text-base font-semibold capitalize tracking-tight"
                      >
                        {metric}
                      </h2>
                      <span className="meta">
                        {metric === "strain" ? "Lower is better" : "Higher is better"}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                        {value === null ? "—" : value.toFixed(1)}
                      </span>
                      <span className="text-sm font-medium text-slate-400">/ 100</span>
                    </div>

                    {value !== null ? (
                      <meter
                        className="h-2 w-full overflow-hidden rounded-full"
                        aria-labelledby={`score-${metric}`}
                        min={0}
                        max={100}
                        value={value}
                      >
                        {value}
                      </meter>
                    ) : null}
                  </div>

                  <div className="border-t border-slate-200 pt-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Factors
                    </h3>
                    {data.factors[metric]?.length ? (
                      <ul className="space-y-3">
                        {data.factors[metric]?.map((factor) => (
                          <li
                            key={factor.key}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span className="font-semibold text-slate-800">{factor.label}</span>
                              <StatusBadge status={factor.tone} />
                            </div>
                            <p className="font-mono text-slate-600">
                              {factor.value} {factor.unit}
                            </p>
                            <p className="text-slate-600">{factor.description}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No factors in this snapshot.</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}

      <section className="panel space-y-4" aria-labelledby="trend-heading">
        <h2 id="trend-heading" className="section-title">
          30-day trend
        </h2>
        <ErrorBanner error={history.error} />
        {history.isPending ? <Loading label="Loading 30-day trend" /> : null}
        {history.data ? (
          <>
            <p className="text-sm text-slate-600">
              {history.data.delta
                ? "Change from first to last snapshot (points):"
                : "Delta unavailable until there are at least two daily snapshots."}
            </p>
            {history.data.delta ? (
              <ul className="flex flex-wrap gap-4 text-xs">
                {healthMetrics.map((metric) => {
                  const delta = history.data?.delta?.[metric] ?? 0;
                  return (
                    <li
                      key={metric}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium"
                    >
                      <span className="capitalize">{metric}</span>:{" "}
                      <span
                        className={
                          (metric === "strain" && delta < 0) || (metric !== "strain" && delta > 0)
                            ? "text-emerald-700"
                            : delta === 0
                              ? "text-slate-600"
                              : "text-amber-700"
                        }
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {points.length ? (
              <div className="overflow-x-auto">
                <table>
                  <caption>
                    Daily snapshots, oldest first. All scores out of 100; lower strain is better.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date (UTC)</th>
                      {healthMetrics.map((metric) => (
                        <th scope="col" key={metric} className="capitalize">
                          {metric}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.computedAt}>
                        <th scope="row" className="font-mono text-xs">
                          <time dateTime={point.computedAt}>{point.computedAt.slice(0, 10)}</time>
                        </th>
                        {healthMetrics.map((metric) => (
                          <td key={metric} className="font-mono text-xs">
                            {scoreValue(point[metric])?.toFixed(1) ?? "Unavailable"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No daily snapshots yet. Capture knowledge, then refresh health.
              </p>
            )}
          </>
        ) : null}
      </section>

      <section className="panel space-y-4" aria-labelledby="suggestions-heading">
        <h2 id="suggestions-heading" className="section-title">
          Suggested actions
        </h2>
        <ErrorBanner error={suggestions.error} />
        {suggestions.isPending ? <Loading label="Loading health suggestions" /> : null}
        {suggestions.data?.items.length === 0 ? (
          <p className="text-sm text-slate-500">
            No actions suggested. Keep capturing useful knowledge.
          </p>
        ) : null}
        <ul className="space-y-3">
          {suggestions.data?.items.map((item) => {
            const route = suggestionRoute(brainId, item.action);
            return (
              <li
                key={item.key}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                  <span className="badge badge-warning">Priority: {item.priority}</span>
                </div>
                <p className="text-sm text-slate-600">{item.description}</p>
                {route ? (
                  <div className="pt-1">
                    <Link to={route} className="btn-secondary text-xs inline-flex">
                      {item.actionLabel} →
                    </Link>
                  </div>
                ) : (
                  <p className="meta">Action unavailable: {item.actionLabel}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
