import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApiError } from "./client";
import { createFakeClient } from "./fake-client";
import { createServer } from "./server";
import { createTools } from "./tools";

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const first: unknown = content[0];
  if (typeof first !== "object" || first === null) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

async function connected(client = createFakeClient({ index: [], pages: {} })) {
  const server = createServer(createTools(client, { brainId: "brn_1" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return {
    mcp,
    client,
    close: async () => {
      await mcp.close();
      await server.close();
    },
  };
}

describe("server", () => {
  test("registers exactly the six tools with the right annotations", async () => {
    const { mcp, close } = await connected();
    try {
      const result = await mcp.listTools();
      expect(result.tools.map((tool) => tool.name)).toEqual([
        "list_brains",
        "index",
        "search",
        "read",
        "remember",
        "source_status",
      ]);
      const byName = new Map(result.tools.map((tool) => [tool.name, tool]));
      for (const name of ["list_brains", "index", "search", "read", "source_status"]) {
        expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true);
      }
      expect(byName.get("remember")?.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
    } finally {
      await close();
    }
  });

  test("publishes descriptions that teach the index, search, read order", async () => {
    const { mcp, close } = await connected();
    try {
      const { tools } = await mcp.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool.description ?? ""]));
      expect(byName.get("index")).toMatch(/orient/i);
      expect(byName.get("search")).toMatch(/before starting a task/i);
      expect(byName.get("read")).toMatch(/only the pages/i);
      expect(byName.get("remember")).toMatch(/only when the user asks/i);
      expect(byName.get("remember")).toMatch(/transcript/i);
      expect(byName.get("remember")).toMatch(/secrets/i);
      expect(byName.get("source_status")).toMatch(/asynchronous/i);
    } finally {
      await close();
    }
  });

  test("calls list_brains over the transport and returns its brains", async () => {
    const { mcp, close } = await connected();
    try {
      const result = await mcp.callTool({ name: "list_brains", arguments: {} });
      const body = JSON.parse(textOf(result.content)) as { brains: { id: string }[] };
      expect(body.brains[0]?.id).toBe("brn_1");
      expect(result.isError).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("calls remember over the transport and returns the async note", async () => {
    const source = {
      id: `src_${"a".repeat(32)}`,
      brainId: "brn_1",
      status: "pending",
      attempts: 0,
      lastError: null,
      affectedPageIds: [],
    };
    const { mcp, close } = await connected(createFakeClient({ capture: source }));
    try {
      const result = await mcp.callTool({
        name: "remember",
        arguments: { claim: "C", evidence: "E", scope: "S" },
      });
      const body = JSON.parse(textOf(result.content)) as { sourceId: string; note: string };
      expect(result.isError).toBeUndefined();
      expect(body.sourceId).toBe(source.id);
      expect(body.note).toContain("source_status");
    } finally {
      await close();
    }
  });

  test("rejects a search without q at the protocol boundary", async () => {
    const { mcp, close } = await connected();
    try {
      const result = await mcp.callTool({ name: "search", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toMatch(/q/);
    } finally {
      await close();
    }
  });

  test("rejects a limit above the search maximum", async () => {
    const { mcp, close } = await connected();
    try {
      const result = await mcp.callTool({ name: "search", arguments: { q: "x", limit: 51 } });
      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toMatch(/limit/);
    } finally {
      await close();
    }
  });

  test("rejects an out-of-range minSimilarity", async () => {
    const { mcp, close } = await connected();
    try {
      const result = await mcp.callTool({
        name: "search",
        arguments: { q: "x", minSimilarity: 1.5 },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toMatch(/minSimilarity/);
    } finally {
      await close();
    }
  });

  test("surfaces a tool failure as isError rather than a protocol error", async () => {
    const client = createFakeClient({
      brains: [{ id: "brn_1", name: "B", slug: "b" }],
      failures: { getIndex: new ApiError(404, "Not found") },
    });
    const { mcp, close } = await connected(client);
    try {
      const result = await mcp.callTool({ name: "index", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toBe("HTTP 404: Not found");
    } finally {
      await close();
    }
  });
});
