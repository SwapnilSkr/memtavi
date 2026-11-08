import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ApiClient, ApiError, type BrainSummary, type SearchQuery } from "./client";

export type ToolResult = CallToolResult;

export interface BrainResolver {
  brainId: string | undefined;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface Tools {
  listBrains(): Promise<ToolResult>;
  index(args: { brainId?: string | undefined; limit?: number | undefined }): Promise<ToolResult>;
  search(args: {
    q: string;
    brainId?: string | undefined;
    limit?: number | undefined;
    minSimilarity?: number | undefined;
  }): Promise<ToolResult>;
  read(args: { slug: string; brainId?: string | undefined }): Promise<ToolResult>;
}

const INDEX_DEFAULT_LIMIT = 40;
const SEARCH_DEFAULT_LIMIT = 10;

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown): ToolResult {
  if (error instanceof ToolError) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
  if (error instanceof ApiError) {
    const status = error.status === 0 ? "network error" : `HTTP ${error.status}`;
    return { content: [{ type: "text", text: `${status}: ${error.message}` }], isError: true };
  }
  return { content: [{ type: "text", text: "The tool failed unexpectedly." }], isError: true };
}

function brainLine(brain: BrainSummary): string {
  return `- ${brain.id} (${brain.name}, slug: ${brain.slug})`;
}

export function createTools(client: ApiClient, resolver: BrainResolver): Tools {
  async function resolveBrain(explicit: string | undefined): Promise<string> {
    if (explicit !== undefined && explicit !== "") return explicit;
    if (resolver.brainId !== undefined && resolver.brainId !== "") return resolver.brainId;

    const brains = await client.listBrains();
    if (brains.items.length === 1) {
      const only = brains.items[0];
      if (only !== undefined) return only.id;
    }
    if (brains.items.length === 0) {
      throw new ToolError(
        "No brains are visible for this subject. Create a brain first, or check MEMTAVI_SUBJECT_ID.",
      );
    }
    const list = brains.items.map(brainLine).join("\n");
    throw new ToolError(
      `More than one brain is available, so brainId is required. Pass brainId to the tool or set MEMTAVI_BRAIN_ID. Available brains:\n${list}`,
    );
  }

  return {
    async listBrains() {
      try {
        const brains = await client.listBrains();
        return text({
          brains: brains.items.map((brain) => ({
            id: brain.id,
            name: brain.name,
            slug: brain.slug,
          })),
          total: brains.total,
        });
      } catch (error) {
        return failure(error);
      }
    },

    async index(args) {
      try {
        const brainId = await resolveBrain(args.brainId);
        const limit = args.limit ?? INDEX_DEFAULT_LIMIT;
        const result = await client.getIndex(brainId, limit);
        return text({
          brainId,
          entries: result.items.map((entry) => ({
            slug: entry.slug,
            title: entry.title,
            summary: entry.summary,
            pageType: entry.pageType,
            pinned: entry.pinned,
          })),
          total: result.total,
          limit: result.limit,
        });
      } catch (error) {
        return failure(error);
      }
    },

    async search(args) {
      try {
        const brainId = await resolveBrain(args.brainId);
        const query: SearchQuery = {
          q: args.q,
          limit: args.limit ?? SEARCH_DEFAULT_LIMIT,
          ...(args.minSimilarity === undefined ? {} : { minSimilarity: args.minSimilarity }),
        };
        const result = await client.search(brainId, query);
        return text({
          brainId,
          q: args.q,
          hits: result.items.map((hit) => ({
            slug: hit.slug,
            title: hit.title,
            summary: hit.summary,
            similarity: hit.similarity,
          })),
          total: result.total,
          limit: result.limit,
        });
      } catch (error) {
        return failure(error);
      }
    },

    async read(args) {
      try {
        const brainId = await resolveBrain(args.brainId);
        const page = await client.getPage(brainId, args.slug);
        return text({
          slug: page.slug,
          title: page.title,
          summary: page.summary,
          version: page.version,
          status: page.status,
          body: page.body,
        });
      } catch (error) {
        return failure(error);
      }
    },
  };
}
