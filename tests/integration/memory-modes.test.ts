import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createFakeProvider } from "@memtavi/llm/fake";
import { createFakeStore } from "@memtavi/storage/fake";
import type { ObjectStore } from "@memtavi/storage/types";
import { createWorker } from "@memtavi/worker";
import { createHarness, type Harness, type RequestOptions } from "../support/harness";

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_APP_DATABASE_URL) {
  throw new Error("Memory mode tests require the disposable test database");
}

interface Source {
  id: string;
  awaitingApproval: boolean;
  stored?: boolean;
  status: string;
}

describe("subject memory modes", () => {
  let harness: Harness;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let store: ObjectStore;
  let puts: string[];
  let brainId: string;
  let siblingBrain: string;
  let viewerKey: string;

  function request(path: string, options: RequestOptions = {}) {
    const headers = new Headers(options.headers);
    headers.set("x-api-key", options.key ?? harness.keys.a);
    headers.set("x-subject-id", options.subject ?? harness.subjects.a);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  function mode(value: string, options: RequestOptions = {}) {
    return request("/v1/memory-settings", { ...options, method: "PUT", body: { mode: value } });
  }

  function capture(
    body: unknown = { kind: "note", content: "Approved memory" },
    options: RequestOptions = {},
  ) {
    return request(`/v1/brains/${brainId}/captures`, { ...options, method: "POST", body });
  }

  function approve(sourceId: string, options: RequestOptions = {}) {
    return request(`/v1/brains/${brainId}/sources/${sourceId}/approve`, {
      ...options,
      method: "POST",
    });
  }

  async function count(table: string) {
    const result = await harness.owner.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM ${table} WHERE tenant_id = $1`,
      [harness.tenants.a],
    );
    return result.rows[0]?.total;
  }

  beforeAll(async () => {
    harness = await createHarness();
    db = await import("@memtavi/db/client");
    const viewer = await harness.request("/v1/api-keys", {
      method: "POST",
      body: { name: "Memory viewer", role: "viewer" },
    });
    expect(viewer.status).toBe(201);
    viewerKey = ((await viewer.json()) as { key: string }).key;
  });

  beforeEach(async () => {
    await harness.owner.query("DELETE FROM brains WHERE tenant_id = $1", [harness.tenants.a]);
    await harness.owner.query("DELETE FROM memory_settings WHERE tenant_id = $1", [
      harness.tenants.a,
    ]);
    const inner = createFakeStore();
    puts = [];
    store = {
      ...inner,
      async put(key, body, contentType) {
        puts.push(key);
        await inner.put(key, body, contentType);
      },
    };
    app = createApp({
      ownerPool: harness.owner,
      withTenant: db.withTenant,
      store,
      now: () => new Date("2026-11-11T00:00:00.000Z"),
    });
    for (const subject of [harness.subjects.a, harness.subjects.b]) {
      const response = await request("/v1/brains", {
        method: "POST",
        subject,
        body: { name: "Memory modes", slug: `modes-${crypto.randomUUID()}` },
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string };
      if (subject === harness.subjects.a) brainId = body.id;
      else siblingBrain = body.id;
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  test("tenant B cannot read or change tenant A settings even for the same subject", async () => {
    const foreignRead = await request("/v1/memory-settings", { key: harness.keys.b });
    expect(await foreignRead.json()).toEqual({ mode: "auto", updatedAt: null });
    expect((await mode("off", { key: harness.keys.b })).status).toBe(200);
    expect(await count("memory_settings")).toBe(0);
    expect(await (await request("/v1/memory-settings")).json()).toEqual({
      mode: "auto",
      updatedAt: null,
    });
    expect((await mode("ask")).status).toBe(200);
    expect(
      (
        (await (await request("/v1/memory-settings", { key: harness.keys.b })).json()) as {
          mode: string;
        }
      ).mode,
    ).toBe("off");
    await db.withTenant(
      harness.tenants.b,
      async (client) => {
        expect(
          (
            await client.query("SELECT * FROM memory_settings WHERE tenant_id = $1", [
              harness.tenants.a,
            ])
          ).rows,
        ).toEqual([]);
        expect(
          (
            await client.query("UPDATE memory_settings SET mode = 'off' WHERE tenant_id = $1", [
              harness.tenants.a,
            ])
          ).rowCount,
        ).toBe(0);
      },
      harness.subjects.a,
    );
  });

  test("an unset subject reads auto without writing and captures enqueue normally", async () => {
    expect(await (await request("/v1/memory-settings")).json()).toEqual({
      mode: "auto",
      updatedAt: null,
    });
    expect(await count("memory_settings")).toBe(0);
    const response = await capture();
    expect(response.status).toBe(201);
    expect(((await response.json()) as Source).awaitingApproval).toBe(false);
    expect(await count("jobs")).toBe(1);
  });

  test("PUT then GET persists each mode and audits every update with the key creator", async () => {
    const auditBefore = await count("audit_events");
    for (const value of ["ask", "off", "auto", "auto"]) {
      const response = await mode(value);
      expect(response.status).toBe(200);
      const settings = (await response.json()) as { mode: string; updatedAt: string };
      expect(settings.mode).toBe(value);
      expect(Number.isNaN(Date.parse(settings.updatedAt))).toBe(false);
      expect(await (await request("/v1/memory-settings")).json()).toEqual(settings);
    }
    expect(await count("audit_events")).toBe((auditBefore ?? 0) + 4);
    const audit = await harness.owner.query(
      `SELECT s.updated_by = k.created_by AS same_actor, s.updated_at IS NOT NULL AS timestamp
       FROM memory_settings s JOIN api_keys k ON k.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 AND s.subject_id = $2 AND k.role = 'owner'`,
      [harness.tenants.a, harness.subjects.a],
    );
    expect(audit.rows).toEqual([{ same_actor: true, timestamp: true }]);
    expect((await mode("invalid")).status).toBe(400);
  });

  test("a viewer can read but cannot PUT or approve", async () => {
    expect((await mode("off", { key: viewerKey })).status).toBe(403);
    expect(await count("memory_settings")).toBe(0);
    expect((await request("/v1/memory-settings", { key: viewerKey })).status).toBe(200);
    await mode("ask");
    const source = (await (await capture()).json()) as Source;
    expect((await approve(source.id, { key: viewerKey })).status).toBe(403);
    expect(await count("jobs")).toBe(0);
  });

  test("off stores no source, object, job, usage or idempotency record for inline and URL capture", async () => {
    await mode("off");
    for (const body of [
      { kind: "note", content: "Do not retain me", metadata: { private: "data" } },
      { kind: "url", fetchUrl: "http://127.0.0.1/private" },
    ]) {
      const response = await capture(body, { headers: { "Idempotency-Key": "off-key" } });
      expect(response.status).toBe(202);
      const source = (await response.json()) as Source & {
        contentPreview: string;
        metadata: unknown;
      };
      expect(source.stored).toBe(false);
      expect(source.awaitingApproval).toBe(false);
      expect(source.contentPreview).toBe("");
      expect(source.metadata).toEqual({});
      expect((await request(`/v1/brains/${brainId}/sources/${source.id}`)).status).toBe(404);
    }
    for (const table of [
      "ingest_sources",
      "source_chunks",
      "jobs",
      "usage_ledger",
      "idempotency_keys",
    ]) {
      expect(await count(table)).toBe(0);
    }
    expect(puts).toEqual([]);
  });

  test("ask stores the body but approval alone enqueues once and FakeProvider compiles it", async () => {
    await mode("ask");
    const response = await capture();
    expect(response.status).toBe(201);
    const source = (await response.json()) as Source;
    const foreign = await approve(source.id, { key: harness.keys.b });
    expect(foreign.status).toBe(404);
    expect((await approve(source.id, { subject: harness.subjects.b })).status).toBe(404);
    expect(source.awaitingApproval).toBe(true);
    expect(source.status).toBe("pending");
    expect(await count("jobs")).toBe(0);
    expect(await count("usage_ledger")).toBe(0);
    expect(puts.length).toBe(1);
    expect(await store.exists(puts[0] ?? "missing")).toBe(true);
    expect(await new Response(await store.get(puts[0] ?? "missing")).text()).toBe(
      "Approved memory",
    );
    const statuses = await Promise.all([approve(source.id), approve(source.id)]);
    expect(statuses.map((item) => item.status).sort()).toEqual([202, 409]);
    expect((await approve(source.id)).status).toBe(409);
    expect(await count("jobs")).toBe(1);
    const provider = createFakeProvider();
    const worker = createWorker({
      withTenant: db.withTenant,
      tenantIds: [harness.tenants.a],
      store,
      compiler: {
        chatProvider: {
          async chat(input) {
            const payload = JSON.parse(input.messages[1]?.content ?? "{}") as {
              chunks?: { chunkUuid: string; text: string }[];
            };
            if (payload.chunks)
              provider.queueChat(
                JSON.stringify({
                  facts: payload.chunks.map((chunk) => ({
                    claim: chunk.text,
                    kind: "project_fact",
                    entities: [],
                    confidence: 0.9,
                    durability: 0.9,
                    impact: 0.9,
                    recurrence: 0.9,
                    novelty: 0.9,
                    futureUse: 0.9,
                    sensitivity: "none",
                    evidence: {
                      chunkUuid: chunk.chunkUuid,
                      charStart: 0,
                      charEnd: chunk.text.length,
                      quote: chunk.text,
                    },
                  })),
                }),
              );
            return provider.chat(input);
          },
        },
        embeddingProvider: provider,
        chatModel: "fake-chat",
        embeddingModel: "fake-embedding",
      },
      random: () => 0,
      log: () => undefined,
    });
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(true);
    const compiled = await request(`/v1/brains/${brainId}/sources/${source.id}`);
    const completed = (await compiled.json()) as Source & { affectedPageIds: string[] };
    expect(completed.awaitingApproval).toBe(false);
    expect(completed.status).toBe("completed");
    expect(completed.affectedPageIds.length).toBeGreaterThan(0);
    expect(provider.calls.some((call) => call.kind === "chat")).toBe(true);
  });

  test("held captures deduplicate and replay without enqueuing and deletion rejects them", async () => {
    await mode("ask");
    const body = { kind: "note", content: "Held", originRef: "held-origin" };
    const options = { headers: { "Idempotency-Key": "held-key" } };
    const first = await capture(body, options);
    const source = (await first.json()) as Source;
    const replay = await capture(body, options);
    expect(replay.status).toBe(first.status);
    expect(await replay.json()).toEqual(source);
    const duplicate = await capture(body);
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as Source).id).toBe(source.id);
    expect(
      (await request(`/v1/brains/${brainId}/sources/${source.id}/retry`, { method: "POST" }))
        .status,
    ).toBe(409);
    expect(
      (await request(`/v1/brains/${brainId}/sources/${source.id}`, { method: "DELETE" })).status,
    ).toBe(202);
    expect((await approve(source.id)).status).toBe(404);
    expect(await count("jobs")).toBe(0);
  });

  test("idempotency receipts written before the approval field replay unchanged", async () => {
    const options = { headers: { "Idempotency-Key": "legacy-key" } };
    const response = await capture(undefined, options);
    const legacy = (await response.json()) as Record<string, unknown>;
    delete legacy.awaitingApproval;
    await harness.owner.query(
      "UPDATE idempotency_keys SET response_body = response_body - 'awaitingApproval' WHERE tenant_id = $1 AND key = 'legacy-key'",
      [harness.tenants.a],
    );
    const replay = await capture(undefined, options);
    expect(replay.status).toBe(response.status);
    expect(await replay.json()).toEqual(legacy);
    expect(await count("jobs")).toBe(1);
    expect(puts.length).toBe(1);
  });

  test("stray ingest and compile jobs cannot process a capture awaiting approval", async () => {
    await mode("ask");
    const source = (await (await capture()).json()) as Source;
    const provider = createFakeProvider();
    const worker = createWorker({
      withTenant: db.withTenant,
      tenantIds: [harness.tenants.a],
      store,
      compiler: {
        chatProvider: provider,
        embeddingProvider: provider,
        chatModel: "fake-chat",
        embeddingModel: "fake-embedding",
      },
      fetchDocument: async () => {
        throw new Error("Held capture must not fetch");
      },
      log: () => undefined,
    });
    for (const type of ["capture.ingest", "capture.compile"]) {
      await harness.owner.query(
        `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          harness.tenants.a,
          brainId,
          type,
          JSON.stringify({ brainId, sourceId: source.id }),
          `stray:${type}`,
        ],
      );
      expect(await worker.runOnce()).toBe(true);
    }
    expect(provider.calls).toEqual([]);
    expect(await count("usage_ledger")).toBe(0);
    expect(await count("source_chunks")).toBe(0);
    expect(puts.length).toBe(1);
    const held = (await (
      await request(`/v1/brains/${brainId}/sources/${source.id}`)
    ).json()) as Source;
    expect(held.awaitingApproval).toBe(true);
    expect(held.status).toBe("pending");
  });

  test("subject B off leaves subject A auto", async () => {
    expect((await capture(undefined, { subject: harness.subjects.b })).status).toBe(404);
    await mode("off", { subject: harness.subjects.b });
    const sibling = await request(`/v1/brains/${siblingBrain}/captures`, {
      method: "POST",
      subject: harness.subjects.b,
      body: { kind: "note", content: "Discard" },
    });
    expect(sibling.status).toBe(202);
    expect((await capture()).status).toBe(201);
    expect(await count("ingest_sources")).toBe(1);
    expect(await count("jobs")).toBe(1);
  });

  test("MCP remember and the shared HTTP client preserve off and ask modes end to end", async () => {
    app.listen({ hostname: "127.0.0.1", port: 0 });
    const child = Bun.spawn([process.execPath, "--no-env-file", "packages/mcp/src/index.ts"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: {
        PATH: process.env.PATH ?? "",
        MEMTAVI_API_URL: `http://127.0.0.1:${app.server?.port}`,
        MEMTAVI_API_KEY: harness.keys.a,
        MEMTAVI_SUBJECT_ID: harness.subjects.a,
        MEMTAVI_BRAIN_ID: brainId,
      },
    });
    const reader = child.stdout.getReader();
    let buffer = "";
    let rpcId = 0;
    async function rpc(method: string, params: unknown) {
      const id = ++rpcId;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      const deadline = setTimeout(() => child.kill(), 5000);
      try {
        while (true) {
          const newline = buffer.indexOf("\n");
          if (newline >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
            if (message.id === id) {
              expect(message.error).toBeUndefined();
              return message.result;
            }
          } else {
            const chunk = await reader.read();
            if (chunk.done) throw new Error("MCP transport closed before response");
            buffer += new TextDecoder().decode(chunk.value);
          }
        }
      } finally {
        clearTimeout(deadline);
      }
    }
    try {
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "memory-mode-test", version: "1" },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      for (const value of ["off", "ask"]) {
        await mode(value);
        const result = (await rpc("tools/call", {
          name: "remember",
          arguments: { claim: "Remember the mode", evidence: "Observed" },
        })) as { isError?: boolean; content: { text: string }[] };
        expect(result.isError).toBeUndefined();
        const receipt = JSON.parse(result.content[0]?.text ?? "{}") as {
          stored: boolean;
          awaitingApproval: boolean;
          note: string;
        };
        expect(receipt.stored).toBe(value !== "off");
        expect(receipt.awaitingApproval).toBe(value === "ask");
        expect(receipt.note).toContain(
          value === "off" ? "Nothing was stored" : "awaiting human approval",
        );
        expect(await count("jobs")).toBe(0);
        expect(await count("ingest_sources")).toBe(value === "off" ? 0 : 1);
        expect(puts.length).toBe(value === "off" ? 0 : 1);
      }
    } finally {
      child.kill();
      await child.exited;
      reader.releaseLock();
      await app.stop();
    }
  }, 15000);
});
