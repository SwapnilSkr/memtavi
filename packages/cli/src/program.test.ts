import { describe, expect, test } from "bun:test";
import type { ApiClient, BrainExport, ChangeEvent } from "@memtavi/client/client";
import { ApiError } from "@memtavi/client/client";
import { createFakeClient, type FakeClient, fakeBrain, fakePage } from "@memtavi/client/testing";
import { type CliDeps, runCli } from "./program";

const EPOCH = "2026-01-01T00:00:00.000Z";

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
  written: Record<string, string>;
}

function harness(
  client: ApiClient,
  options: { brain?: string; files?: Record<string, string> } = {},
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const deps: CliDeps = {
    client,
    brain: options.brain,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    readFile: async (path) => options.files?.[path] ?? "",
    writeFile: async (path, content) => {
      written[path] = content;
    },
  };
  return { deps, out, err, written };
}

function jsonOut(harnessed: Harness): unknown {
  return JSON.parse(harnessed.out[0] ?? "");
}

function call(client: FakeClient, method: keyof ApiClient) {
  return client.calls.find((entry) => entry.method === method);
}

const page = fakePage({
  id: "pg_1",
  slug: "vector-search",
  title: "Vector search",
  summary: "How search works",
  body: "# Body\n\nText.",
  pageType: "topic",
  status: "active",
  version: 4,
});

const hit = {
  pageId: "pg_1",
  slug: "vector-search",
  title: "Vector search",
  summary: "How search works",
  similarity: 0.82,
};

const change: ChangeEvent = {
  id: "chg_1",
  brainId: "brn_1",
  pageId: "pg_1",
  action: "updated",
  changeSummary: "Edited by user",
  fromVersion: 1,
  toVersion: 2,
  ingestSourceId: null,
  contradictions: [],
  ackedAt: null,
  createdAt: EPOCH,
};

const exported: BrainExport = {
  brain: fakeBrain({ id: "brn_1", name: "Work", slug: "work" }),
  pages: [page],
  versions: [],
  sources: [],
  connections: [],
};

describe("brains", () => {
  test("lists brains as a human table", async () => {
    const client = createFakeClient({ brains: [{ id: "brn_1", name: "Work", slug: "work" }] });
    const h = harness(client);
    const code = await runCli(["brains"], h.deps);

    expect(code).toBe(0);
    expect(h.out[0]).toContain("ID");
    expect(h.out[0]).toContain("brn_1");
    expect(h.out[0]).toContain("Work");
  });

  test("emits the paginated list as JSON", async () => {
    const client = createFakeClient({ brains: [{ id: "brn_1", name: "Work", slug: "work" }] });
    const h = harness(client);
    const code = await runCli(["brains", "--json"], h.deps);

    expect(code).toBe(0);
    expect(jsonOut(h)).toMatchObject({
      items: [{ id: "brn_1", name: "Work", slug: "work" }],
      total: 1,
    });
  });
});

describe("search", () => {
  test("renders hits with the similarity column", async () => {
    const client = createFakeClient({ hits: [hit] });
    const h = harness(client);
    const code = await runCli(["search", "vector", "--limit", "5"], h.deps);

    expect(code).toBe(0);
    expect(h.out[0]).toContain("SIMILARITY");
    expect(h.out[0]).toContain("0.820");
    expect(h.out[0]).toContain("vector-search");
  });

  test("sends the query and the flags to the client", async () => {
    const client = createFakeClient({ hits: [hit] });
    const h = harness(client);
    await runCli(["search", "vector", "--limit", "5", "--min-similarity", "0.4"], h.deps);

    expect(call(client, "search")).toEqual({
      method: "search",
      args: ["brn_1", { q: "vector", limit: 5, minSimilarity: 0.4 }],
    });
  });

  test("emits the JSON shape", async () => {
    const client = createFakeClient({ hits: [hit] });
    const h = harness(client);
    await runCli(["--json", "search", "vector"], h.deps);

    expect(jsonOut(h)).toMatchObject({
      items: [{ slug: "vector-search", similarity: 0.82 }],
    });
  });
});

describe("pages", () => {
  test("reads one page as a readable block", async () => {
    const client = createFakeClient({ pages: { "vector-search": page } });
    const h = harness(client);
    const code = await runCli(["page", "get", "vector-search"], h.deps);

    expect(code).toBe(0);
    expect(h.out[0]).toContain("# Vector search");
    expect(h.out[0]).toContain("version: 4");
    expect(h.out[0]).toContain("# Body");
  });

  test("edits a page and reads the body from a file", async () => {
    const client = createFakeClient({ pages: { "vector-search": page } });
    const h = harness(client, { files: { "body.md": "# New body" } });
    const code = await runCli(
      [
        "page",
        "edit",
        "vector-search",
        "--title",
        "New",
        "--body-file",
        "body.md",
        "--version",
        "4",
      ],
      h.deps,
    );

    expect(code).toBe(0);
    expect(call(client, "updatePage")).toEqual({
      method: "updatePage",
      args: ["brn_1", "vector-search", { title: "New", body: "# New body", version: 4 }],
    });
  });

  test("requires --permanent before deleting", async () => {
    const client = createFakeClient();
    const h = harness(client);
    const code = await runCli(["page", "delete", "vector-search"], h.deps);

    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("--permanent");
    expect(client.calls).toEqual([]);
  });
});

describe("captures", () => {
  const source = { id: "src_1", brainId: "brn_1", status: "pending" as const };

  test("captures a note with a label", async () => {
    const client = createFakeClient({ capture: source });
    const h = harness(client);
    const code = await runCli(["capture", "note", "Hello", "--label", "inbox"], h.deps);

    expect(code).toBe(0);
    expect(call(client, "createCapture")).toEqual({
      method: "createCapture",
      args: ["brn_1", { kind: "note", content: "Hello", label: "inbox" }],
    });
    expect(h.out[0]).toContain("src_1");
    expect(h.out[0]).toContain("pending");
  });

  test("captures a url as fetchUrl", async () => {
    const client = createFakeClient({ capture: { ...source, kind: "url" } });
    const h = harness(client);
    await runCli(["capture", "url", "https://example.com"], h.deps);

    expect(call(client, "createCapture")).toEqual({
      method: "createCapture",
      args: ["brn_1", { kind: "url", fetchUrl: "https://example.com" }],
    });
  });

  test("reports the source status", async () => {
    const client = createFakeClient({ sources: { src_1: source } });
    const h = harness(client);
    const code = await runCli(["capture", "status", "src_1"], h.deps);

    expect(code).toBe(0);
    expect(h.out[0]).toContain("attempts: 0");
  });
});

describe("changes", () => {
  test("acknowledges a change", async () => {
    const client = createFakeClient({ changes: [change] });
    const h = harness(client);
    const code = await runCli(["change", "ack", "chg_1"], h.deps);

    expect(code).toBe(0);
    expect(call(client, "ackChange")).toEqual({
      method: "ackChange",
      args: ["brn_1", "chg_1", true],
    });
    expect(h.out[0]).toBe("acknowledged chg_1");
  });

  test("lists changes in a table", async () => {
    const client = createFakeClient({ changes: [change] });
    const h = harness(client);
    const code = await runCli(["changes"], h.deps);

    expect(code).toBe(0);
    expect(h.out[0]).toContain("chg_1");
    expect(h.out[0]).toContain("updated");
  });
});

describe("export", () => {
  test("writes JSON to stdout by default", async () => {
    const client = createFakeClient({ exported });
    const h = harness(client);
    const code = await runCli(["export"], h.deps);

    expect(code).toBe(0);
    expect(JSON.parse(h.out[0] ?? "")).toMatchObject({ brain: { id: "brn_1" } });
  });

  test("writes to a file when --out is given", async () => {
    const client = createFakeClient({ exported });
    const h = harness(client);
    const code = await runCli(["export", "--out", "brain.json"], h.deps);

    expect(code).toBe(0);
    expect(h.out).toEqual([]);
    expect(h.err[0]).toBe("wrote brain.json");
    expect(JSON.parse(h.written["brain.json"] ?? "{}")).toMatchObject({
      pages: [{ slug: "vector-search" }],
    });
  });
});

describe("profile", () => {
  test("updates fields and directives from a file", async () => {
    const client = createFakeClient();
    const h = harness(client, { files: { "directives.json": '{"tone":"plain"}' } });
    const code = await runCli(
      ["profile", "set", "--focus", "search", "--directives", "directives.json"],
      h.deps,
    );

    expect(code).toBe(0);
    expect(call(client, "updateProfile")).toEqual({
      method: "updateProfile",
      args: ["brn_1", { focus: "search", directives: { tone: "plain" } }],
    });
  });

  test("rejects a directives file that is not a JSON object", async () => {
    const client = createFakeClient();
    const h = harness(client, { files: { "directives.json": "[]" } });
    const code = await runCli(["profile", "set", "--directives", "directives.json"], h.deps);

    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("JSON object");
  });
});

describe("brain resolution", () => {
  const two = [
    { id: "brn_1", name: "Work", slug: "work" },
    { id: "brn_2", name: "Home", slug: "home" },
  ];

  test("prefers --brain over everything", async () => {
    const client = createFakeClient({ brains: two, index: [] });
    const h = harness(client, { brain: "brn_env" });
    await runCli(["index", "--brain", "brn_arg"], h.deps);

    expect(client.calls.map((call) => call.method)).toEqual(["getIndex"]);
    expect(client.calls[0]?.args).toEqual(["brn_arg", undefined]);
  });

  test("uses MEMTAVI_BRAIN_ID when no flag is given", async () => {
    const client = createFakeClient({ brains: two, index: [] });
    const h = harness(client, { brain: "brn_env" });
    await runCli(["index"], h.deps);

    expect(client.calls.map((call) => call.method)).toEqual(["getIndex"]);
    expect(client.calls[0]?.args[0]).toBe("brn_env");
  });

  test("falls back to the only brain", async () => {
    const client = createFakeClient({
      brains: [{ id: "brn_only", name: "Only", slug: "only" }],
      index: [],
    });
    const h = harness(client);
    await runCli(["index"], h.deps);

    expect(client.calls.map((call) => call.method)).toEqual(["listBrains", "getIndex"]);
    expect(client.calls[1]?.args[0]).toBe("brn_only");
  });

  test("refuses to guess between multiple brains", async () => {
    const client = createFakeClient({ brains: two });
    const h = harness(client);
    const code = await runCli(["index"], h.deps);

    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("--brain");
    expect(h.err.join("\n")).toContain("brn_2");
    expect(client.calls.map((call) => call.method)).toEqual(["listBrains"]);
  });

  test("explains an empty brain list as a configuration error", async () => {
    const client = createFakeClient({ brains: [] });
    const h = harness(client);
    const code = await runCli(["index"], h.deps);

    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("No brains are visible");
  });
});

describe("webhooks", () => {
  const hook = {
    id: "whk_1",
    subjectId: "sub_1",
    url: "https://example.com/hooks",
    events: ["created" as const, "updated" as const],
    active: true,
  };

  test("lists webhooks for the subject without resolving a brain", async () => {
    const client = createFakeClient({ webhooks: [hook] });
    const h = harness(client);
    const code = await runCli(["webhooks"], h.deps);

    expect(code).toBe(0);
    expect(h.out[0]).toContain("whk_1");
    expect(h.out[0]).toContain("created,updated");
    expect(client.calls.map((entry) => entry.method)).toEqual(["listWebhooks"]);
  });

  test("creates a webhook with repeatable events and prints the secret once", async () => {
    const client = createFakeClient({
      createdWebhook: { ...hook, secret: "whsec_once" },
    });
    const h = harness(client);
    const code = await runCli(
      [
        "webhook",
        "create",
        "--url",
        "https://example.com/hooks",
        "--event",
        "created",
        "--event",
        "updated",
      ],
      h.deps,
    );

    expect(code).toBe(0);
    expect(call(client, "createWebhook")).toEqual({
      method: "createWebhook",
      args: [{ url: "https://example.com/hooks", events: ["created", "updated"] }],
    });
    expect(h.out[0]).toContain("secret: whsec_once");
    expect(h.out[0]).toContain("shown once");
    expect(h.out[0]).toContain("cannot be retrieved again");
  });

  test("includes the secret in --json output", async () => {
    const client = createFakeClient({
      createdWebhook: { ...hook, secret: "whsec_once" },
    });
    const h = harness(client);
    const code = await runCli(
      ["--json", "webhook", "create", "--url", "https://example.com/hooks", "--event", "created"],
      h.deps,
    );

    expect(code).toBe(0);
    expect(jsonOut(h)).toMatchObject({ id: "whk_1", secret: "whsec_once" });
  });

  test("requires at least one event", async () => {
    const client = createFakeClient();
    const h = harness(client);
    const code = await runCli(["webhook", "create", "--url", "https://example.com/hooks"], h.deps);

    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("--event");
    expect(client.calls).toEqual([]);
  });

  test("deletes a webhook by id", async () => {
    const client = createFakeClient();
    const h = harness(client);
    const code = await runCli(["webhook", "delete", "whk_1"], h.deps);

    expect(code).toBe(0);
    expect(call(client, "deleteWebhook")).toEqual({
      method: "deleteWebhook",
      args: ["whk_1"],
    });
    expect(h.out[0]).toBe("deleted whk_1");
  });
});

describe("exit codes", () => {
  test("returns 1 and the API message for an API failure", async () => {
    const client = createFakeClient({
      failures: { getIndex: new ApiError(404, "Not found", { code: "NotFoundError" }) },
    });
    const h = harness(client);
    const code = await runCli(["index", "--brain", "brn_1"], h.deps);

    expect(code).toBe(1);
    expect(h.err[0]).toBe("HTTP 404: Not found");
  });

  test("returns 2 for an unknown command", async () => {
    const client = createFakeClient();
    const h = harness(client);
    const code = await runCli(["nope"], h.deps);

    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("unknown command");
  });

  test("returns 2 for a missing argument", async () => {
    const client = createFakeClient();
    const h = harness(client);
    const code = await runCli(["search"], h.deps);

    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("q");
  });

  test("returns 0 for --help and lists every command", async () => {
    const client = createFakeClient();
    const h = harness(client);
    const code = await runCli(["--help"], h.deps);

    expect(code).toBe(0);
    const help = h.out.join("\n");
    for (const command of ["brains", "capture", "index", "search", "page", "changes", "export"]) {
      expect(help).toContain(command);
    }
  });
});
