import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import type { ExtractedFact } from "@memtavi/core/compile/schemas";
import type { HealthFactor } from "@memtavi/core/health/compute";
import { enqueueScoreSnapshot, insertScoreSnapshot } from "@memtavi/db/health";
import { createFakeProvider } from "@memtavi/llm/fake";
import { type ChatRequest, ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { contentHash } from "@memtavi/storage/keys";
import { createWorker } from "@memtavi/worker";
import { compileCapture } from "@memtavi/worker/compile";
import type { CompilerConfig } from "@memtavi/worker/types";
import { Pool, type PoolClient } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";
import { snapshotScore } from "../../apps/worker/src/health";

interface ScoreBody {
  brainId: string;
  computedAt: string;
  freshness: number;
  readiness: number;
  strain: number;
  factors: {
    freshness: HealthFactor[];
    readiness: HealthFactor[];
    strain: HealthFactor[];
  };
}

interface SnapshotRow {
  freshness: number;
  readiness: number;
  strain: number;
  factors: ScoreBody["factors"];
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");

describe.skipIf(!ownerUrl || !appUrl)("brain health snapshots", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const store = createFakeStore();
  const slugA = `health-${crypto.randomUUID()}`;
  const slugB = `health-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const chatModel = "fake-chat";
  const embeddingModel = "fake-embedding";
  const keys = new Map<string, string>();
  let tenantA = "";
  let tenantB = "";
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let provider = createFakeProvider();
  let failChat: ProviderError | undefined;
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  function withTenant<T>(
    tenant: string,
    callback: (client: PoolClient) => Promise<T>,
    subject?: string,
  ): Promise<T> {
    return db.withTenant(tenant, callback, subject);
  }

  function request(
    path: string,
    options: { key?: string; subject?: string | null; method?: string; body?: unknown } = {},
  ) {
    const headers = new Headers();
    headers.set("x-api-key", options.key ?? keys.get("owner") ?? "");
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subjectA);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return app.handle(
      new Request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  async function createBrain(subject: string, name: string, key = keys.get("owner") ?? "") {
    const created = await request("/v1/brains", {
      key,
      subject,
      method: "POST",
      body: { name, slug: `${name}-${crypto.randomUUID()}` },
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  function compiler(): CompilerConfig {
    return {
      chatModel,
      embeddingModel,
      chatProvider: {
        chat: async (request: ChatRequest) => {
          if (failChat) throw failChat;
          const input = JSON.parse(request.messages[1]?.content ?? "{}") as {
            chunks?: { chunkUuid: string; text: string }[];
          };
          if (input.chunks) {
            const facts = input.chunks.map(
              (chunk): ExtractedFact => ({
                claim: chunk.text.trim(),
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
              }),
            );
            provider.queueChat(JSON.stringify({ facts }));
          }
          return provider.chat(request);
        },
      },
      embeddingProvider: { embed: (texts) => provider.embed(texts) },
    };
  }

  function worker() {
    return createWorker({
      withTenant,
      tenantIds: [tenantA],
      store,
      compiler: compiler(),
      handlers: {
        "capture.compile": compileCapture,
        "score.snapshot": snapshotScore,
      },
      random: () => 0,
      fetchDocument: async () => {
        throw new Error("Network is forbidden");
      },
    });
  }

  async function capture(brainId: string, text: string) {
    const sourceId = newId("source");
    await owner.query(
      `INSERT INTO ingest_sources
       (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
       VALUES ($1, $2, $3, $4, 'note', $5, $6)`,
      [sourceId, tenantA, subjectA, brainId, text, contentHash(text)],
    );
    await owner.query(
      `INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key)
       VALUES ($1, $2, 'capture.compile', $3, $4)`,
      [tenantA, brainId, JSON.stringify({ sourceId, brainId }), `compile:${sourceId}`],
    );
  }

  async function snapshotCount(brainId: string): Promise<number> {
    const result = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM score_snapshots WHERE brain_id = $1",
      [brainId],
    );
    return result.rows[0]?.total ?? 0;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Health fixtures require a disposable memtavi_test database");
    }
    fixturesAuthorized = true;
    process.env.APP_DATABASE_URL = appUrl;
    db = await import("@memtavi/db/client");
    app = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store,
      now: () => fixedNow,
    });
    keys.set("owner", await bootstrap(owner, "Health A", slugA));
    keys.set("foreign", await bootstrap(owner, "Health B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";
    tenantB = tenants.rows.find((row) => row.slug === slugB)?.id ?? "";
    expect(tenantA).not.toBe("");
    expect(tenantB).not.toBe("");
  });

  beforeEach(() => {
    provider = createFakeProvider();
    failChat = undefined;
  });

  afterEach(async () => {
    const instance = worker();
    for (let i = 0; i < 20; i += 1) {
      if (!(await instance.runOnce())) return;
    }
    throw new Error("Health fixture queue did not drain");
  });

  afterAll(async () => {
    if (fixturesAuthorized) {
      const actors = await owner.query<{ created_by: string }>(
        `SELECT k.created_by FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
         WHERE t.slug = ANY($1::text[])`,
        [[slugA, slugB]],
      );
      await owner.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [[slugA, slugB]]);
      await owner.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [...new Set(actors.rows.map((row) => row.created_by))],
      ]);
    }
    await Promise.all([owner.end(), application.end()]);
    if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previousAppUrl;
  });

  test("a completed compile enqueues one snapshot and the handler persists it", async () => {
    const brainId = await createBrain(subjectA, "compiled");
    await capture(brainId, "The compiler preserves evidence.");
    const instance = worker();
    expect(await instance.runOnce()).toBe(true);

    const queued = await owner.query<{ type: string; status: string }>(
      `SELECT type, status FROM jobs WHERE brain_id = $1
       AND type IN ('capture.compile', 'score.snapshot') ORDER BY type`,
      [brainId],
    );
    expect(queued.rows).toEqual([
      { type: "capture.compile", status: "completed" },
      { type: "score.snapshot", status: "pending" },
    ]);
    expect(await snapshotCount(brainId)).toBe(0);

    expect(await instance.runOnce()).toBe(true);
    const jobs = await owner.query<{ type: string; status: string }>(
      `SELECT type, status FROM jobs WHERE brain_id = $1
       AND type IN ('capture.compile', 'score.snapshot') ORDER BY type`,
      [brainId],
    );
    expect(jobs.rows).toEqual([
      { type: "capture.compile", status: "completed" },
      { type: "score.snapshot", status: "completed" },
    ]);

    const snapshot = (
      await owner.query<SnapshotRow>(
        "SELECT freshness, readiness, strain, factors FROM score_snapshots WHERE brain_id = $1",
        [brainId],
      )
    ).rows[0];
    expect(snapshot).toBeDefined();
    expect(snapshot?.freshness).toBeGreaterThan(0);
    expect(snapshot?.readiness).toBeGreaterThan(0);
    expect(
      snapshot?.factors.freshness.find((factor) => factor.key === "recent_captures"),
    ).toMatchObject({ value: 1, tone: "positive" });
    expect(snapshot?.factors.readiness.map((factor) => factor.key)).toEqual([
      "pages",
      "searchable_pages",
      "profile_completeness",
      "failed_sources",
      "contested_pages",
    ]);
    expect(snapshot?.factors.strain.map((factor) => factor.key)).toEqual([
      "failed_sources",
      "compile_backlog",
      "contested_pages",
      "deprecated_pages",
      "unacked_changes",
      "unacked_connections",
    ]);
  });

  test("a burst of compiles writes one snapshot job per brain per minute bucket", async () => {
    const brainId = await createBrain(subjectA, "burst");
    await withTenant(tenantA, async (client) => {
      await enqueueScoreSnapshot(client, tenantA, brainId);
      await enqueueScoreSnapshot(client, tenantA, brainId);
      await enqueueScoreSnapshot(client, tenantA, brainId);
    });
    const queued = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM jobs WHERE brain_id = $1 AND type = 'score.snapshot'",
      [brainId],
    );
    expect(queued.rows[0]?.total).toBe(1);
    expect(await worker().runOnce()).toBe(true);
  });

  test("a permanently failed compile still enqueues a snapshot that records the failure", async () => {
    const brainId = await createBrain(subjectA, "failed");
    await capture(brainId, "A source that cannot compile.");
    failChat = new ProviderError("bad_request", false, "private upstream detail");
    const instance = worker();
    expect(await instance.runOnce()).toBe(true);
    expect(
      (
        await owner.query<{ status: string }>(
          "SELECT status FROM jobs WHERE brain_id = $1 AND type = 'capture.compile'",
          [brainId],
        )
      ).rows[0]?.status,
    ).toBe("dead");
    expect(
      (
        await owner.query<{ total: number }>(
          "SELECT count(*)::int AS total FROM jobs WHERE brain_id = $1 AND type = 'score.snapshot'",
          [brainId],
        )
      ).rows[0]?.total,
    ).toBe(1);
    expect(await instance.runOnce()).toBe(true);
    const snapshot = (
      await owner.query<SnapshotRow>(
        "SELECT freshness, readiness, strain, factors FROM score_snapshots WHERE brain_id = $1",
        [brainId],
      )
    ).rows[0];
    expect(snapshot?.strain).toBeGreaterThan(0);
    expect(
      snapshot?.factors.strain.find((factor) => factor.key === "failed_sources"),
    ).toMatchObject({
      value: 1,
      tone: "negative",
    });
  });

  test("a failed source lowers readiness and raises strain with a matching factor", async () => {
    const brainId = await createBrain(subjectA, "change");
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash)
       VALUES ($1, $2, $3, $4, 'baseline', 'Baseline', 'baseline')`,
      [newId("page"), tenantA, subjectA, brainId],
    );
    await owner.query(
      `INSERT INTO profiles (brain_id, tenant_id, who_they_are, what_they_do)
       VALUES ($1, $2, 'A builder', 'Builds tools')`,
      [brainId, tenantA],
    );
    const before = await withTenant(tenantA, (client) =>
      insertScoreSnapshot(client, tenantA, brainId),
    );
    await owner.query(
      `INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash, status)
       VALUES ($1, $2, $3, $4, 'note', 'Broken source', 'broken', 'failed')`,
      [newId("source"), tenantA, subjectA, brainId],
    );
    const after = await withTenant(tenantA, (client) =>
      insertScoreSnapshot(client, tenantA, brainId),
    );
    expect(after.readiness).toBeLessThan(before.readiness);
    expect(after.strain).toBeGreaterThan(before.strain);
    expect(after.factors.readiness.find((factor) => factor.key === "failed_sources")).toMatchObject(
      {
        value: 1,
        tone: "negative",
      },
    );
    expect(after.factors.strain.find((factor) => factor.key === "failed_sources")).toMatchObject({
      value: 1,
      tone: "negative",
    });
  });

  test("the API computes a snapshot on demand and never leaks another subject or tenant", async () => {
    const brainId = await createBrain(subjectA, "on-demand");
    const response = await request(`/v1/brains/${brainId}/score`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ScoreBody;
    expect(body.brainId).toBe(brainId);
    expect(typeof body.computedAt).toBe("string");
    expect(Object.keys(body.factors).sort()).toEqual(["freshness", "readiness", "strain"]);
    expect(await snapshotCount(brainId)).toBe(1);

    const again = await request(`/v1/brains/${brainId}/score`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as ScoreBody).computedAt).toBe(body.computedAt);
    expect(await snapshotCount(brainId)).toBe(1);

    const hiddenBrain = await createBrain(subjectB, "hidden");
    const hidden = await request(`/v1/brains/${hiddenBrain}/score`);
    expect(hidden.status).toBe(404);
    expect(await snapshotCount(hiddenBrain)).toBe(0);

    const foreign = await request(`/v1/brains/${brainId}/score`, {
      key: keys.get("foreign") ?? "",
      subject: subjectB,
    });
    expect(foreign.status).toBe(404);
    expect(await snapshotCount(brainId)).toBe(1);

    const absent = await request(`/v1/brains/${newId("brain")}/score`);
    expect(absent.status).toBe(404);
  });
});
