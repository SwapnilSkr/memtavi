import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
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
        <h1>Brain health</h1>
        <button
          type="button"
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
      <p>
        Scores range from 0 to 100. Higher freshness and readiness are better. Lower strain is
        better.
      </p>
      <ErrorBanner error={score.error} />
      {score.isPending ? <Loading label="Loading health score" /> : null}
      {data === null ? (
        <EmptyState>
          <p>
            No snapshot yet.{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/capture`}>Capture knowledge</Link>,
            then refresh health.
          </p>
        </EmptyState>
      ) : null}
      {data ? (
        <>
          <p>
            Computed{" "}
            <time dateTime={data.computedAt}>{new Date(data.computedAt).toLocaleString()}</time>
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {healthMetrics.map((metric) => {
              const value = scoreValue(data[metric]);
              return (
                <section className="panel min-w-0" key={metric} aria-labelledby={`score-${metric}`}>
                  <h2 id={`score-${metric}`} className="capitalize">
                    {metric}
                  </h2>
                  <p>{value === null ? "Unavailable" : `${value.toFixed(1)} / 100`}</p>
                  {value !== null ? (
                    <meter
                      className="w-full"
                      aria-labelledby={`score-${metric}`}
                      min={0}
                      max={100}
                      value={value}
                    >
                      {value}
                    </meter>
                  ) : null}
                  <p>{metric === "strain" ? "Lower is better" : "Higher is better"}</p>
                  <h3>Factors</h3>
                  {data.factors[metric]?.length ? (
                    <ul className="space-y-3">
                      {data.factors[metric]?.map((factor) => (
                        <li key={factor.key} className="break-words">
                          <p>
                            <strong>{factor.label}</strong>: {factor.value} {factor.unit}
                          </p>
                          <p
                            className={
                              factor.tone === "negative"
                                ? "text-red-800"
                                : factor.tone === "positive"
                                  ? "text-emerald-800"
                                  : "text-slate-600"
                            }
                          >
                            {factor.tone}
                          </p>
                          <p>{factor.description}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No factors in this snapshot.</p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : null}
      <section className="panel" aria-labelledby="trend-heading">
        <h2 id="trend-heading">30-day trend</h2>
        <ErrorBanner error={history.error} />
        {history.isPending ? <Loading label="Loading 30-day trend" /> : null}
        {history.data ? (
          <>
            <p>
              {history.data.delta
                ? "Change from first to last snapshot (points):"
                : "Delta unavailable until there are at least two daily snapshots."}
            </p>
            {history.data.delta ? (
              <ul>
                {healthMetrics.map((metric) => {
                  const delta = history.data?.delta?.[metric] ?? 0;
                  return (
                    <li key={metric}>
                      {metric}: {delta > 0 ? "+" : ""}
                      {delta.toFixed(1)}
                      {metric === "strain" ? " (lower is better)" : " (higher is better)"}
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
                        <th scope="col" key={metric}>
                          {metric}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.computedAt}>
                        <th scope="row">
                          <time dateTime={point.computedAt}>{point.computedAt.slice(0, 10)}</time>
                        </th>
                        {healthMetrics.map((metric) => (
                          <td key={metric}>
                            {scoreValue(point[metric])?.toFixed(1) ?? "Unavailable"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No daily snapshots yet. Capture knowledge, then refresh health.</p>
            )}
          </>
        ) : null}
      </section>
      <section className="panel" aria-labelledby="suggestions-heading">
        <h2 id="suggestions-heading">Suggested actions</h2>
        <ErrorBanner error={suggestions.error} />
        {suggestions.isPending ? <Loading label="Loading health suggestions" /> : null}
        {suggestions.data?.items.length === 0 ? (
          <p>No actions suggested. Keep capturing useful knowledge.</p>
        ) : null}
        <ul className="space-y-4">
          {suggestions.data?.items.map((item) => {
            const route = suggestionRoute(brainId, item.action);
            return (
              <li key={item.key}>
                <h3>{item.title}</h3>
                <p>Priority: {item.priority}</p>
                <p>{item.description}</p>
                {route ? (
                  <Link to={route}>{item.actionLabel}</Link>
                ) : (
                  <p>Action unavailable: {item.actionLabel}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
