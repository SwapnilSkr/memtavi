import type { Graph, GraphEdge, GraphNode } from "./api";

export interface GraphLayout {
  width: number;
  height: number;
  nodes: (GraphNode & { x: number; y: number })[];
  edges: (GraphEdge & { x1: number; y1: number; x2: number; y2: number })[];
}

export function layoutGraph(graph: Graph): GraphLayout {
  const sorted = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const columns = Math.min(3, Math.max(1, sorted.length));
  const nodes = sorted.map((node, index) => ({
    ...node,
    x: 140 + (index % columns) * 280,
    y: 80 + Math.floor(index / columns) * 160,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = [...graph.edges]
    .sort((a, b) =>
      a.connectionId < b.connectionId ? -1 : a.connectionId > b.connectionId ? 1 : 0,
    )
    .flatMap((edge) => {
      const start = byId.get(edge.pageAId);
      const end = byId.get(edge.pageBId);
      return start && end ? [{ ...edge, x1: start.x, y1: start.y, x2: end.x, y2: end.y }] : [];
    });
  return {
    width: columns * 280,
    height: Math.max(1, Math.ceil(nodes.length / columns)) * 160,
    nodes,
    edges,
  };
}
