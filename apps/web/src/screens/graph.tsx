import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorBanner, Loading } from "../components/feedback";
import { useApi } from "../lib/api-context";
import { layoutGraph } from "../lib/graph-layout";

const strengths = { weak: 1, medium: 3, strong: 6 };

export function GraphScreen() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const graph = useQuery({
    queryKey: ["graph", brainId, {}],
    queryFn: () => api.getGraph(brainId),
  });
  const layout = useMemo(() => (graph.data ? layoutGraph(graph.data) : null), [graph.data]);
  return (
    <>
      <h1>Brain graph</h1>
      <p className="text-slate-600">
        Follow a page to inspect it. Thicker lines mean stronger connections.
      </p>
      <ErrorBanner error={graph.error} />
      {graph.isPending ? <Loading label="Loading brain graph" /> : null}
      {layout?.nodes.length === 0 ? (
        <EmptyState>
          <p>
            No pages to graph yet.{" "}
            <Link to={`/brains/${encodeURIComponent(brainId)}/capture`}>
              Capture some knowledge
            </Link>{" "}
            to get started.
          </p>
        </EmptyState>
      ) : null}
      {layout && layout.nodes.length > 0 ? (
        <section className="panel min-w-0" aria-label="Page connections">
          <p className="help" aria-live="polite">
            {layout.nodes.length} pages · {layout.edges.length} connections. Scroll horizontally to
            explore the graph on smaller screens.
          </p>
          <ul className="my-4 flex flex-wrap gap-5 text-sm" aria-label="Connection strength legend">
            {(["weak", "medium", "strong"] as const).map((strength) => (
              <li key={strength} className="flex items-center gap-2">
                <svg width="32" height="12" aria-hidden="true">
                  <line
                    x1="0"
                    y1="6"
                    x2="32"
                    y2="6"
                    stroke="currentColor"
                    strokeWidth={strengths[strength]}
                  />
                </svg>
                {strength}
              </li>
            ))}
          </ul>
          <section className="overflow-x-auto" aria-label="Scrollable brain graph">
            <svg
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-label={`Brain graph with ${layout.nodes.length} pages and ${layout.edges.length} connections. Each page is a link; line thickness shows connection strength.`}
            >
              <title>Brain graph</title>
              {layout.edges.map((edge) => (
                <line
                  key={edge.connectionId}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke="currentColor"
                  className="text-slate-400"
                  strokeWidth={strengths[edge.strength]}
                >
                  <title>{edge.strength} connection</title>
                </line>
              ))}
              {layout.nodes.map((node) => (
                <Link
                  key={node.id}
                  to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(node.slug)}`}
                  aria-label={`${node.title} · ${node.status}`}
                >
                  <title>{node.title}</title>
                  <rect
                    x={node.x - 120}
                    y={node.y - 40}
                    width="240"
                    height="80"
                    rx="8"
                    className={
                      node.status === "contested"
                        ? "fill-amber-50 stroke-amber-600"
                        : "fill-white stroke-slate-400"
                    }
                  />
                  <foreignObject x={node.x - 108} y={node.y - 24} width="216" height="24">
                    <div className="truncate text-center text-sm text-indigo-700">{node.title}</div>
                  </foreignObject>
                  <text
                    x={node.x}
                    y={node.y + 20}
                    textAnchor="middle"
                    className="fill-slate-700 text-xs"
                  >
                    {node.status === "contested" ? "Disputed · contested" : node.status}
                    {node.pinned ? " · pinned" : ""}
                  </text>
                </Link>
              ))}
            </svg>
          </section>
        </section>
      ) : null}
    </>
  );
}
