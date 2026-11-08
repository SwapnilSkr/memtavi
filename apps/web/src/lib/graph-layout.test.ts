import { expect, test } from "bun:test";
import type { Graph, GraphEdge, GraphNode } from "./api";
import { layoutGraph } from "./graph-layout";

function node(id: string): GraphNode {
  return {
    id,
    slug: id,
    title: id,
    pageType: "topic",
    bucket: "notes",
    status: "active",
    pinned: false,
  };
}

function edge(connectionId: string, pageAId: string, pageBId: string): GraphEdge {
  return { connectionId, pageAId, pageBId, similarity: 0.8, strength: "strong", source: "auto" };
}

test("an empty graph has no positions and a finite canvas", () => {
  const layout = layoutGraph({ nodes: [], edges: [] });
  expect(layout.nodes).toHaveLength(0);
  expect(layout.edges).toHaveLength(0);
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.height).toBeGreaterThan(0);
});

test("one node is centered with space for its label", () => {
  const layout = layoutGraph({ nodes: [node("pg_one")], edges: [] });
  expect(layout.nodes[0]?.x).toBe(layout.width / 2);
  expect(layout.nodes[0]?.y).toBe(layout.height / 2);
});

test.each([2, 3, 4, 30, 101])(
  "all %i nodes and their edges have distinct, bounded positions",
  (count) => {
    const nodes = Array.from({ length: count }, (_, i) => node(`pg_${i}`));
    const edges = nodes.slice(1).map((entry, i) => edge(`cnn_${i}`, "pg_0", entry.id));
    const layout = layoutGraph({ nodes, edges });
    expect(layout.nodes).toHaveLength(count);
    expect(layout.edges).toHaveLength(count - 1);
    expect(new Set(layout.nodes.map(({ x, y }) => `${x},${y}`)).size).toBe(count);
    for (const positioned of layout.nodes) {
      expect(positioned.x - 120).toBeGreaterThanOrEqual(0);
      expect(positioned.x + 120).toBeLessThanOrEqual(layout.width);
      expect(positioned.y - 40).toBeGreaterThanOrEqual(0);
      expect(positioned.y + 40).toBeLessThanOrEqual(layout.height);
    }
    for (const positioned of layout.edges) {
      const start = layout.nodes.find((entry) => entry.id === positioned.pageAId);
      const end = layout.nodes.find((entry) => entry.id === positioned.pageBId);
      if (!start || !end) throw new Error("Missing edge endpoint");
      expect([positioned.x1, positioned.y1]).toEqual([start.x, start.y]);
      expect([positioned.x2, positioned.y2]).toEqual([end.x, end.y]);
    }
  },
);

test("positions are deterministic regardless of API order and leave input untouched", () => {
  const graph: Graph = {
    nodes: [node("pg_c"), node("pg_a"), node("pg_b")],
    edges: [edge("cnn_b", "pg_b", "pg_c"), edge("cnn_a", "pg_a", "pg_b")],
  };
  const before = structuredClone(graph);
  const first = layoutGraph(graph);
  expect(layoutGraph(graph)).toEqual(first);
  expect(
    layoutGraph({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }),
  ).toEqual(first);
  expect(graph).toEqual(before);
});

test("edges with missing endpoints are omitted without inventing nodes", () => {
  const layout = layoutGraph({
    nodes: [node("pg_a")],
    edges: [edge("cnn_a", "pg_a", "pg_missing")],
  });
  expect(layout.nodes).toHaveLength(1);
  expect(layout.edges).toHaveLength(0);
});
