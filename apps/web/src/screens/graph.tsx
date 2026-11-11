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
      <div>
        <h1>Brain graph</h1>
        <p className="mt-1 text-slate-600">
          Follow a page to inspect it. Thicker lines mean stronger connections.
        </p>
      </div>
      <ErrorBanner error={graph.error} />
      {graph.isPending ? <Loading label="Loading brain graph" /> : null}
      {layout?.nodes.length === 0 ? (
        <EmptyState>
          <p>
            No pages to graph yet.{" "}
            <Link
              to={`/brains/${encodeURIComponent(brainId)}/capture`}
              className="font-medium text-indigo-700 hover:underline"
            >
              Capture some knowledge
            </Link>{" "}
            to get started.
          </p>
        </EmptyState>
      ) : null}
      {layout && layout.nodes.length > 0 ? (
        <section className="panel min-w-0 space-y-4" aria-label="Page connections">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
            <p className="meta" aria-live="polite">
              {layout.nodes.length} pages · {layout.edges.length} connections. Scroll horizontally
              to explore the graph on smaller screens.
            </p>
            <ul
              className="flex flex-wrap gap-4 text-xs font-medium text-slate-600"
              aria-label="Connection strength legend"
            >
              {(["weak", "medium", "strong"] as const).map((strength) => (
                <li key={strength} className="flex items-center gap-1.5">
                  <svg width="28" height="12" aria-hidden="true">
                    <line
                      x1="0"
                      y1="6"
                      x2="28"
                      y2="6"
                      stroke="currentColor"
                      className="text-slate-500"
                      strokeWidth={strengths[strength]}
                    />
                  </svg>
                  <span className="capitalize">{strength}</span>
                </li>
              ))}
            </ul>
          </div>
          <section
            className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50/50 p-4"
            aria-label="Scrollable brain graph"
          >
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
                  className="text-slate-300"
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
                        ? "fill-amber-50 stroke-amber-500 stroke-2"
                        : "fill-white stroke-slate-200 stroke-1 shadow-xs"
                    }
                  />
                  <foreignObject x={node.x - 108} y={node.y - 24} width="216" height="24">
                    <div className="truncate text-center text-sm font-semibold text-slate-900">
                      {node.title}
                    </div>
                  </foreignObject>
                  <text
                    x={node.x}
                    y={node.y + 20}
                    textAnchor="middle"
                    className={`text-xs font-medium ${
                      node.status === "contested"
                        ? "fill-amber-900 font-semibold"
                        : "fill-slate-500"
                    }`}
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
