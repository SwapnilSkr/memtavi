import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";

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
  const data = score.data;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1>Latest health score</h1>
        <button type="button" disabled={score.isFetching} onClick={() => void score.refetch()}>
          {score.isFetching ? "Refreshing…" : "Refresh score"}
        </button>
      </div>
      <ErrorBanner error={score.error} />
      {score.isPending ? <Loading label="Loading health score" /> : null}
      <div aria-live="polite">
        {score.data === null ? (
          <EmptyState>
            <p>No score has been computed yet. Use Refresh score to check again.</p>
          </EmptyState>
        ) : null}
      </div>
      {data ? (
        <>
          <p className="help">
            Computed{" "}
            <time dateTime={data.computedAt}>{new Date(data.computedAt).toLocaleString()}</time>
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(["freshness", "readiness", "strain"] as const).map((metric) => {
              const raw = data[metric];
              const value = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
              return (
                <section className="panel" key={metric} aria-labelledby={`score-${metric}`}>
                  <h2 id={`score-${metric}`} className="capitalize">
                    {metric}
                  </h2>
                  <p className="my-3 text-2xl tabular-nums">
                    {value.toFixed(2)} <span className="text-sm text-slate-500">/ 1</span>
                  </p>
                  <meter
                    className="block h-5 w-full"
                    aria-labelledby={`score-${metric}`}
                    min={0}
                    max={1}
                    value={value}
                  >
                    {value.toFixed(2)}
                  </meter>
                </section>
              );
            })}
          </div>
          <section className="panel min-w-0" aria-labelledby="score-factors">
            <h2 id="score-factors">Factors</h2>
            {Object.keys(data.factors).length === 0 ? (
              <p className="help">No factors were included in this snapshot.</p>
            ) : (
              <table className="mt-4 table-fixed">
                <caption className="sr-only">Health score factor breakdown</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-1/3 break-words">
                      Factor
                    </th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.factors).map(([key, value]) => (
                    <tr key={key}>
                      <th scope="row" className="break-words [overflow-wrap:anywhere]">
                        {key}
                      </th>
                      <td>
                        <pre className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
