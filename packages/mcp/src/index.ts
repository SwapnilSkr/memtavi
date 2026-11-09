#!/usr/bin/env bun
import { ApiError, createClient } from "@memtavi/client/client";
import { ConfigError, loadConfig } from "@memtavi/client/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";
import { createTools } from "./tools";

function note(message: string): void {
  process.stderr.write(`memtavi-mcp: ${message}\n`);
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      note(`configuration error: ${error.message}`);
      process.exit(1);
    }
    note("configuration error: could not read the environment");
    process.exit(1);
  }

  const client = createClient({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    subjectId: config.subjectId,
  });

  const server = createServer(createTools(client, { brainId: config.brainId }));
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    note("shutting down");
    server.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    await server.connect(transport);
    note(`ready at ${config.apiUrl}`);
  } catch (error) {
    if (error instanceof ApiError) {
      note(`${error.status === 0 ? "network error" : `HTTP ${error.status}`}: ${error.message}`);
    } else {
      note("failed to start the transport");
    }
    process.exit(1);
  }
}

main().catch(() => {
  note("fatal: the server did not start");
  process.exit(1);
});
