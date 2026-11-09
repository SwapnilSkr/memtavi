#!/usr/bin/env bun
import { createClient } from "@memtavi/client/client";
import { ConfigError, loadConfig } from "@memtavi/client/config";
import { type CliIo, runCli } from "./program";

const io: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`memtavi: ${text}\n`),
  readFile: (path) => Bun.file(path).text(),
  writeFile: async (path, content) => {
    await Bun.write(path, content);
  },
};

function envBrain(): string | undefined {
  const value = process.env.MEMTAVI_BRAIN_ID?.trim();
  return value === undefined || value === "" ? undefined : value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const meta = argv.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg));

  if (meta) {
    const client = createClient({
      apiUrl: "http://localhost:3000",
      apiKey: "",
      subjectId: "",
    });
    process.exit(await runCli(argv, { ...io, client, brain: envBrain() }));
  }

  const config = loadConfig(process.env);
  const client = createClient({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    subjectId: config.subjectId,
  });

  const code = await runCli(argv, {
    ...io,
    client,
    brain: config.brainId,
  });
  process.exit(code);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError ? error.message : "could not start";
  process.stderr.write(`memtavi: ${message}\n`);
  process.exit(1);
});
