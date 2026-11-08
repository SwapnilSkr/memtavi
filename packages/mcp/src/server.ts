import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Tools } from "./tools";

export const SERVER_NAME = "memtavi";
export const SERVER_VERSION = "0.1.0";

const brainIdArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Brain to read. Omit when MEMTAVI_BRAIN_ID is set or the subject has exactly one brain.",
  );

const INDEX_DESCRIPTION = [
  "Read the compact index of a brain: slug, title, summary, type and pinned flag for each page.",
  "Start here to orient before searching or reading. The index is small; it is not the page body.",
  "Use the returned slug with `read`.",
].join(" ");

const SEARCH_DESCRIPTION = [
  "Search a brain by phrase and get ranked page hits with slug, title, summary and similarity.",
  "Search before starting a task so you reuse existing memory instead of re-deriving it.",
  "Keyword matches ignore minSimilarity; semantic-only matches respect it. Then `read` only the pages you need.",
].join(" ");

const READ_DESCRIPTION = [
  "Read one page by slug: title, summary, version, status and the full markdown body.",
  "Read only the pages a task actually needs; the whole index is already available through `index`.",
  "Reading a page bumps its lastReferencedAt, so avoid reading pages speculatively.",
].join(" ");

const LIST_DESCRIPTION = [
  "List the brains visible to the configured subject, with id, name and slug.",
  "Use it to discover the brainId other tools accept when more than one brain is available.",
].join(" ");

export function createServer(tools: Tools): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "list_brains",
    { description: LIST_DESCRIPTION, annotations: { readOnlyHint: true } },
    () => tools.listBrains(),
  );

  server.registerTool(
    "index",
    {
      description: INDEX_DESCRIPTION,
      inputSchema: {
        brainId: brainIdArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum index entries to return. Defaults to 40."),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => tools.index(args),
  );

  server.registerTool(
    "search",
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        q: z.string().min(1).describe("The search phrase. Required."),
        brainId: brainIdArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum hits to return, 1-50. Defaults to 10."),
        minSimilarity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Lowest vector similarity for semantic-only matches, 0-1."),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => tools.search(args),
  );

  server.registerTool(
    "read",
    {
      description: READ_DESCRIPTION,
      inputSchema: {
        slug: z.string().min(1).describe("The page slug within the brain. Required."),
        brainId: brainIdArg,
      },
      annotations: { readOnlyHint: true },
    },
    (args) => tools.read(args),
  );

  return server;
}
