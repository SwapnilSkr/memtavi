import {
  type ApiClient,
  ApiError,
  type ChangeEvent,
  type Connection,
  type IngestSource,
  type Page,
  type PageUpdate,
  type Profile,
  type ProfileUpdate,
  type Score,
  type Webhook,
  type WebhookEvent,
} from "@memtavi/client/client";
import { ConfigError } from "@memtavi/client/config";
import { Command, CommanderError, InvalidArgumentError } from "commander";

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

export interface CliDeps extends CliIo {
  client: ApiClient;
  brain?: string | undefined;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

interface GlobalOptions {
  brain?: string | undefined;
  json?: boolean | undefined;
}

const VERSION = "0.1.0";

const BRAIN_OPTION = "brain id; falls back to MEMTAVI_BRAIN_ID then the only brain";
const JSON_OPTION = "print machine-readable JSON instead of the human view";

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const render = (cells: string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [render(headers), ...rows.map(render)].join("\n");
}

function pageBlock(page: Page): string {
  return [
    `# ${page.title}`,
    `slug: ${page.slug}`,
    `type: ${page.pageType}  status: ${page.status}  version: ${page.version}`,
    "",
    page.summary,
    "",
    page.body,
  ].join("\n");
}

function sourceBlock(source: IngestSource): string {
  return [
    `source: ${source.id}`,
    `status: ${source.status}`,
    `attempts: ${source.attempts}`,
    `lastError: ${source.lastError ?? "-"}`,
    `affectedPages: ${source.affectedPageIds.join(", ") || "-"}`,
  ].join("\n");
}

function profileBlock(profile: Profile): string {
  return [
    `brain: ${profile.brainId}`,
    `whoTheyAre: ${profile.whoTheyAre}`,
    `whatTheyDo: ${profile.whatTheyDo}`,
    `focus: ${profile.focus}`,
    `goals: ${profile.goals}`,
    `currentProjects: ${profile.currentProjects}`,
    `stuckOn: ${profile.stuckOn}`,
    `vaultOrganization: ${profile.vaultOrganization}`,
    `directives: ${JSON.stringify(profile.directives)}`,
  ].join("\n");
}

function scoreBlock(score: Score): string {
  return [
    `brain: ${score.brainId}`,
    `computedAt: ${score.computedAt}`,
    `freshness: ${score.freshness}`,
    `readiness: ${score.readiness}`,
    `strain: ${score.strain}`,
    `factors: ${JSON.stringify(score.factors)}`,
  ].join("\n");
}

function connectionRows(connections: Connection[]): string[][] {
  return connections.map((connection) => [
    connection.id,
    connection.pageAId,
    connection.pageBId,
    connection.similarity.toFixed(3),
    connection.strength,
    connection.ackedAt ?? "-",
  ]);
}

function changeRows(changes: ChangeEvent[]): string[][] {
  return changes.map((change) => [
    change.id,
    change.action,
    change.changeSummary,
    change.ackedAt ?? "-",
    change.createdAt,
  ]);
}

function webhookRows(webhooks: Webhook[]): string[][] {
  return webhooks.map((webhook) => [
    webhook.id,
    webhook.events.join(","),
    webhook.active ? "active" : "inactive",
    webhook.url,
  ]);
}

function collectEvent(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer.");
  }
  return parsed;
}

function parseSimilarity(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError("must be a number between 0 and 1.");
  }
  return parsed;
}

async function resolveBrain(client: ApiClient, explicit: string | undefined): Promise<string> {
  if (explicit !== undefined && explicit !== "") return explicit;

  const brains = await client.listBrains();
  if (brains.items.length === 1) {
    const only = brains.items[0];
    if (only !== undefined) return only.id;
  }
  if (brains.items.length === 0) {
    throw new ConfigError(
      "No brains are visible for this subject. Create a brain first, or check MEMTAVI_SUBJECT_ID.",
    );
  }
  const list = brains.items.map((brain) => `- ${brain.id} (${brain.name})`).join("\n");
  throw new UsageError(
    `More than one brain is available. Pass --brain <brainId> or set MEMTAVI_BRAIN_ID. Available brains:\n${list}`,
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const status = error.status === 0 ? "network error" : `HTTP ${error.status}`;
    return `${status}: ${error.message}`;
  }
  if (error instanceof ConfigError) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

function addGlobals(command: Command): void {
  command.option("--brain <brainId>", BRAIN_OPTION);
  command.option("--json", JSON_OPTION);
  for (const child of command.commands) addGlobals(child);
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command("memtavi")
    .description("Drive every Memtavi API operation from the terminal.")
    .version(VERSION, "-V", "output the version number")
    .option("--brain <brainId>", BRAIN_OPTION)
    .option("--json", JSON_OPTION);

  const globals = (command: Command): { brain: string | undefined; json: boolean } => {
    const options = command.optsWithGlobals<GlobalOptions>();
    return { brain: options.brain ?? deps.brain, json: options.json === true };
  };

  const emit = <T>(command: Command, value: T, human: (value: T) => string): void => {
    deps.out(globals(command).json ? JSON.stringify(value, null, 2) : human(value));
  };

  const brainId = async (command: Command): Promise<string> =>
    resolveBrain(deps.client, globals(command).brain);

  program
    .command("brains")
    .description("List the brains visible to the subject")
    .action(async (_options: unknown, command: Command) => {
      const result = await deps.client.listBrains();
      emit(command, result, (listed) =>
        table(
          ["ID", "NAME", "SLUG"],
          listed.items.map((brain) => [brain.id, brain.name, brain.slug]),
        ),
      );
    });

  const capture = program.command("capture").description("Submit material for compilation");

  capture
    .command("note <text>")
    .description("Capture an inline note")
    .option("--label <label>", "label the capture")
    .action(async (text: string, options: { label?: string }, command: Command) => {
      const brain = await brainId(command);
      const source = await deps.client.createCapture(brain, {
        kind: "note",
        content: text,
        ...(options.label === undefined ? {} : { label: options.label }),
      });
      emit(command, source, sourceBlock);
    });

  capture
    .command("url <url>")
    .description("Capture a URL for the fetcher")
    .option("--label <label>", "label the capture")
    .action(async (url: string, options: { label?: string }, command: Command) => {
      const brain = await brainId(command);
      const source = await deps.client.createCapture(brain, {
        kind: "url",
        fetchUrl: url,
        ...(options.label === undefined ? {} : { label: options.label }),
      });
      emit(command, source, sourceBlock);
    });

  capture
    .command("status <sourceId>")
    .description("Read an ingest source and its compilation status")
    .action(async (sourceId: string, _options: unknown, command: Command) => {
      const brain = await brainId(command);
      const source = await deps.client.getSource(brain, sourceId);
      emit(command, source, sourceBlock);
    });

  program
    .command("index")
    .description("Read the compact brain index")
    .option("--limit <count>", "maximum entries, 1-200", parseCount)
    .action(async (options: { limit?: number }, command: Command) => {
      const brain = await brainId(command);
      const result = await deps.client.getIndex(brain, options.limit);
      emit(command, result, (listed) =>
        table(
          ["SLUG", "TYPE", "TITLE", "SUMMARY"],
          listed.items.map((entry) => [entry.slug, entry.pageType, entry.title, entry.summary]),
        ),
      );
    });

  program
    .command("search")
    .description("Search a brain by phrase")
    .argument("<q>", "the search phrase")
    .option("--limit <count>", "maximum hits, 1-200", parseCount)
    .option("--min-similarity <value>", "lowest vector similarity, 0-1", parseSimilarity)
    .action(
      async (q: string, options: { limit?: number; minSimilarity?: number }, command: Command) => {
        const brain = await brainId(command);
        const result = await deps.client.search(brain, {
          q,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
          ...(options.minSimilarity === undefined ? {} : { minSimilarity: options.minSimilarity }),
        });
        emit(command, result, (listed) =>
          table(
            ["SLUG", "SIMILARITY", "TITLE", "SUMMARY"],
            listed.items.map((hit) => [
              hit.slug,
              hit.similarity === null ? "-" : hit.similarity.toFixed(3),
              hit.title,
              hit.summary,
            ]),
          ),
        );
      },
    );

  const page = program.command("page").description("Read, edit and delete pages");

  page
    .command("get <slug>")
    .description("Read one page by slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const brain = await brainId(command);
      const found = await deps.client.getPage(brain, slug);
      emit(command, found, pageBlock);
    });

  page
    .command("edit <slug>")
    .description("Apply a user edit and record a new version")
    .option("--title <text>", "new title")
    .option("--summary <text>", "new summary")
    .option("--body-file <file>", "read the new body from a file")
    .option("--status <status>", "new page status")
    .option("--version <number>", "the version the client last read", parseCount)
    .action(
      async (
        slug: string,
        options: Record<string, string | number | undefined>,
        command: Command,
      ) => {
        const update: PageUpdate = {};
        if (options.title !== undefined) update.title = String(options.title);
        if (options.summary !== undefined) update.summary = String(options.summary);
        if (options.bodyFile !== undefined) {
          update.body = await deps.readFile(String(options.bodyFile));
        }
        if (options.status !== undefined) {
          update.status = String(options.status) as PageUpdate["status"];
        }
        if (options.version !== undefined) update.version = Number(options.version);
        if (Object.keys(update).length === 0) {
          throw new UsageError(
            "page edit needs at least one of --title, --summary, --body-file, --status or --version.",
          );
        }
        const brain = await brainId(command);
        const updated = await deps.client.updatePage(brain, slug, update);
        emit(command, updated, pageBlock);
      },
    );

  page
    .command("delete <slug>")
    .description("Permanently delete a page")
    .option("--permanent", "confirm the permanent deletion")
    .action(async (slug: string, options: { permanent?: boolean }, command: Command) => {
      if (options.permanent !== true) {
        throw new UsageError("page delete requires --permanent to confirm.");
      }
      const brain = await brainId(command);
      const receipt = await deps.client.deletePage(brain, slug, { permanent: true });
      emit(command, receipt, (result) => `deleted ${result.id} (${result.state})`);
    });

  program
    .command("changes")
    .description("List the change feed")
    .action(async (_options: unknown, command: Command) => {
      const brain = await brainId(command);
      const result = await deps.client.listChanges(brain);
      emit(command, result, (listed) =>
        table(["ID", "ACTION", "SUMMARY", "ACKED", "CREATED"], changeRows(listed.items)),
      );
    });

  const change = program.command("change").description("Work with one change event");
  change
    .command("ack <id>")
    .description("Acknowledge a change event")
    .action(async (id: string, _options: unknown, command: Command) => {
      const brain = await brainId(command);
      const result = await deps.client.ackChange(brain, id);
      emit(command, result, (event) => `acknowledged ${event.id}`);
    });

  program
    .command("connections")
    .description("List semantic connections")
    .action(async (_options: unknown, command: Command) => {
      const brain = await brainId(command);
      const result = await deps.client.listConnections(brain);
      emit(command, result, (listed) =>
        table(
          ["ID", "PAGE A", "PAGE B", "SIMILARITY", "STRENGTH", "ACKED"],
          connectionRows(listed.items),
        ),
      );
    });

  const connection = program.command("connection").description("Work with one connection");
  connection
    .command("ack <id>")
    .description("Acknowledge a connection")
    .action(async (id: string, _options: unknown, command: Command) => {
      const brain = await brainId(command);
      const result = await deps.client.ackConnection(brain, id);
      emit(command, result, (acked) => `acknowledged ${acked.id}`);
    });

  program
    .command("graph")
    .description("Show page nodes and connection edges")
    .action(async (_options: unknown, command: Command) => {
      const brain = await brainId(command);
      const result = await deps.client.getGraph(brain);
      emit(command, result, (value) =>
        [
          `nodes: ${value.nodes.length}  edges: ${value.edges.length}`,
          "",
          table(
            ["ID", "SLUG", "TITLE", "TYPE", "STATUS"],
            value.nodes.map((node) => [node.id, node.slug, node.title, node.pageType, node.status]),
          ),
          "",
          table(
            ["PAGE A", "PAGE B", "SIMILARITY", "STRENGTH"],
            value.edges.map((edge) => [
              edge.pageAId,
              edge.pageBId,
              edge.similarity.toFixed(3),
              edge.strength,
            ]),
          ),
        ].join("\n"),
      );
    });

  program
    .command("score")
    .description("Show the latest brain health snapshot")
    .action(async (_options: unknown, command: Command) => {
      const brain = await brainId(command);
      const result = await deps.client.getScore(brain);
      emit(command, result, scoreBlock);
    });

  const profile = program.command("profile").description("Read or update the subject profile");
  profile.action(async (_options: unknown, command: Command) => {
    const brain = await brainId(command);
    const result = await deps.client.getProfile(brain);
    emit(command, result, profileBlock);
  });

  profile
    .command("set")
    .description("Update one or more profile fields")
    .option("--who-they-are <text>", "who the subject is")
    .option("--what-they-do <text>", "what the subject does")
    .option("--focus <text>", "current focus")
    .option("--goals <text>", "goals")
    .option("--current-projects <text>", "current projects")
    .option("--stuck-on <text>", "what the subject is stuck on")
    .option("--vault-organization <text>", "how the vault is organised")
    .option("--directives <file>", "read a JSON object of directives from a file")
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      const update: ProfileUpdate = {};
      if (options.whoTheyAre !== undefined) update.whoTheyAre = options.whoTheyAre;
      if (options.whatTheyDo !== undefined) update.whatTheyDo = options.whatTheyDo;
      if (options.focus !== undefined) update.focus = options.focus;
      if (options.goals !== undefined) update.goals = options.goals;
      if (options.currentProjects !== undefined) update.currentProjects = options.currentProjects;
      if (options.stuckOn !== undefined) update.stuckOn = options.stuckOn;
      if (options.vaultOrganization !== undefined) {
        update.vaultOrganization = options.vaultOrganization;
      }
      if (options.directives !== undefined) {
        const raw = await deps.readFile(options.directives);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new UsageError("--directives must point at a JSON object file.");
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new UsageError("--directives must point at a JSON object file.");
        }
        update.directives = parsed as Record<string, unknown>;
      }
      if (Object.keys(update).length === 0) {
        throw new UsageError("profile set needs at least one field or --directives.");
      }
      const brain = await brainId(command);
      const result = await deps.client.updateProfile(brain, update);
      emit(command, result, profileBlock);
    });

  program
    .command("export")
    .description("Export the whole brain")
    .option("--out <file>", "write the export to a file instead of stdout")
    .action(async (options: { out?: string }, command: Command) => {
      const brain = await brainId(command);
      const bundle = await deps.client.exportBrain(brain);
      const json = JSON.stringify(bundle, null, 2);
      if (options.out === undefined) {
        deps.out(json);
        return;
      }
      await deps.writeFile(options.out, `${json}\n`);
      deps.err(`wrote ${options.out}`);
    });

  program
    .command("webhooks")
    .description("List the webhooks registered for the subject")
    .action(async (_options: unknown, command: Command) => {
      const result = await deps.client.listWebhooks();
      emit(command, result, (listed) =>
        table(["ID", "EVENTS", "STATUS", "URL"], webhookRows(listed.items)),
      );
    });

  const webhook = program.command("webhook").description("Register or remove a webhook");

  webhook
    .command("create")
    .description("Register a webhook and print its signing secret once")
    .requiredOption("--url <url>", "the http or https endpoint to deliver to")
    .option("--event <name>", "an event name to subscribe to; repeat for several", collectEvent, [])
    .action(async (options: { url: string; event: string[] }, command: Command) => {
      if (options.event.length === 0) {
        throw new UsageError("webhook create requires at least one --event.");
      }
      const created = await deps.client.createWebhook({
        url: options.url,
        events: options.event as WebhookEvent[],
      });
      if (globals(command).json) {
        deps.out(JSON.stringify(created, null, 2));
        return;
      }
      deps.out(
        [
          `webhook: ${created.id}`,
          `events: ${created.events.join(", ")}`,
          `url: ${created.url}`,
          `secret: ${created.secret}`,
          "",
          "Store this secret now. It is shown once and cannot be retrieved again.",
        ].join("\n"),
      );
    });

  webhook
    .command("delete <id>")
    .description("Delete a webhook")
    .action(async (id: string, _options: unknown, command: Command) => {
      await deps.client.deleteWebhook(id);
      emit(command, { id, deleted: true }, () => `deleted ${id}`);
    });

  for (const child of program.commands) addGlobals(child);

  return program;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const program = buildProgram(deps);

  const configure = (command: Command): void => {
    command.exitOverride();
    command.configureOutput({
      writeOut: (text) => deps.out(text.replace(/\n$/, "")),
      writeErr: (text) => deps.err(text.replace(/\n$/, "")),
    });
    for (const child of command.commands) configure(child);
  };
  configure(program);

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 2;
    }
    if (error instanceof UsageError) {
      deps.err(error.message);
      return 2;
    }
    deps.err(describeError(error));
    return 1;
  }
}
