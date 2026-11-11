import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { computeHealth, type HealthMetrics } from "@memtavi/core/health/compute";
import { type Contract, createContract, readSpec } from "../support/contract";
import { createHarness, type Harness, hasTestDatabase } from "../support/harness";

interface HistoryPoint {
  computedAt: string;
  freshness: number;
  readiness: number;
  strain: number;
}

interface HistoryDelta {
  freshness: number;
  readiness: number;
  strain: number;
}

interface HistoryBody {
  range: string;
  points: HistoryPoint[];
  delta: HistoryDelta | null;
}

interface Suggestion {
  key: string;
  title: string;
  description: string;
  action: string;
  actionLabel: string;
  priority: string;
}

interface SuggestionsBody {
  generatedBy: string;
  basedOn: string;
  items: Suggestion[];
}

interface SeedSnapshot {
  computedAt: string;
  freshness: number;
  readiness: number;
  strain: number;
  factors?: unknown;
}

const HISTORY = "/v1/brains/{brainId}/score/history";
const SUGGESTIONS = "/v1/brains/{brainId}/score/suggestions";

const SNAPSHOTS: SeedSnapshot[] = [
  { computedAt: "2026-06-01T12:00:00.000Z", freshness: 1, readiness: 2, strain: 3 },
  { computedAt: "2026-09-15T10:00:00.000Z", freshness: 10, readiness: 20, strain: 30 },
  { computedAt: "2026-10-18T10:00:00.000Z", freshness: 20, readiness: 30, strain: 40 },
  { computedAt: "2026-10-18T20:00:00.000Z", freshness: 25.5, readiness: 35.5, strain: 45.5 },
  { computedAt: "2026-10-28T08:00:00.000Z", freshness: 40, readiness: 50, strain: 60 },
  { computedAt: "2026-11-06T09:00:00.000Z", freshness: 35, readiness: 45, strain: 55 },
  { computedAt: "2026-11-06T23:00:00.000Z", freshness: 50, readiness: 60, strain: 70 },
];

function metrics(overrides: Partial<HealthMetrics> = {}): HealthMetrics {
  return {
    now: "2026-11-06T12:00:00.000Z",
    pageCount: 40,
    searchablePages: 40,
    contestedPages: 0,
    deprecatedPages: 0,
    failedSources: 0,
    backlogSources: 0,
    recentCaptures: 3,
    recentPageChanges: 5,
    unackedChanges: 0,
    unackedConnections: 0,
    profileFields: 7,
    lastCaptureAt: "2026-11-05T00:00:00.000Z",
    lastPageChangeAt: "2026-11-05T00:00:00.000Z",
    ...overrides,
  };
}

const STRAINED = metrics({
  pageCount: 4,
  searchablePages: 1,
  contestedPages: 4,
  deprecatedPages: 3,
  failedSources: 6,
  backlogSources: 5,
  recentCaptures: 0,
  recentPageChanges: 0,
  unackedChanges: 8,
  unackedConnections: 8,
  profileFields: 0,
  lastCaptureAt: null,
  lastPageChangeAt: null,
});

const STRAINED_KEYS = [
  "resolve_contested_pages",
  "retry_failed_sources",
  "capture_recent_input",
  "review_unacked_changes",
  "review_unacked_connections",
  "fill_profile",
];

describe.skipIf(!hasTestDatabase)("score history and suggestions over the wire", () => {
  let harness: Harness;
  let contract: Contract;
  let historyBrain = "";
  let strainedBrain = "";
  let healthyBrain = "";
  let emptyBrain = "";
  let hiddenBrain = "";
  let viewerKey = "";

  function request(path: string, options: Parameters<Harness["request"]>[1] = {}) {
    return harness.request(path, options);
  }

  async function expectStatus(
    response: Response,
    status: number,
    method: string,
    template: string,
  ): Promise<unknown> {
    const body = await response.json();
    expect({ status: response.status, method, path: template }).toEqual({
      status,
      method,
      path: template,
    });
    contract.expectContract(response, body, { method, path: template });
    return body;
  }

  async function createBrain(name: string, subject: string): Promise<string> {
    const created = await request("/v1/brains", {
      method: "POST",
      subject,
      body: { name, slug: `${name}-${crypto.randomUUID()}` },
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  async function seedSnapshots(brainId: string, snapshots: SeedSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
      await harness.owner.query(
        `INSERT INTO score_snapshots
           (tenant_id, brain_id, computed_at, freshness, readiness, strain, factors)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          harness.tenants.a,
          brainId,
          snapshot.computedAt,
          snapshot.freshness,
          snapshot.readiness,
          snapshot.strain,
          JSON.stringify(snapshot.factors ?? {}),
        ],
      );
    }
  }

  async function snapshotCount(brainId: string): Promise<number> {
    const result = await harness.owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM score_snapshots WHERE brain_id = $1",
      [brainId],
    );
    return result.rows[0]?.total ?? 0;
  }

  beforeAll(async () => {
    harness = await createHarness();
    contract = createContract(readSpec());

    historyBrain = await createBrain("history", harness.subjects.a);
    strainedBrain = await createBrain("strained", harness.subjects.a);
    healthyBrain = await createBrain("healthy", harness.subjects.a);
    emptyBrain = await createBrain("empty", harness.subjects.a);
    hiddenBrain = await createBrain("hidden", harness.subjects.b);

    await seedSnapshots(historyBrain, SNAPSHOTS);
    await seedSnapshots(strainedBrain, [
      {
        computedAt: "2026-11-06T12:00:00.000Z",
        freshness: 0,
        readiness: 0,
        strain: 100,
        factors: computeHealth(STRAINED).factors,
      },
    ]);
    await seedSnapshots(healthyBrain, [
      {
        computedAt: "2026-11-06T12:00:00.000Z",
        freshness: 100,
        readiness: 100,
        strain: 0,
        factors: computeHealth(metrics()).factors,
      },
    ]);

    const viewer = await request("/v1/api-keys", {
      method: "POST",
      body: { name: "Score viewer", role: "viewer" },
    });
    expect(viewer.status).toBe(201);
    viewerKey = ((await viewer.json()) as { key: string }).key;
  });

  afterAll(async () => {
    await harness?.close();
  });

  test("history keeps the latest snapshot of each UTC day, oldest first, with a delta", async () => {
    const response = await request(`/v1/brains/${historyBrain}/score/history`);
    const body = (await expectStatus(response, 200, "GET", HISTORY)) as HistoryBody;
    expect(Object.keys(body).sort()).toEqual(["delta", "points", "range"]);
    expect(body.range).toBe("30d");
    expect(body.points).toEqual([
      { computedAt: "2026-10-18T20:00:00.000Z", freshness: 25.5, readiness: 35.5, strain: 45.5 },
      { computedAt: "2026-10-28T08:00:00.000Z", freshness: 40, readiness: 50, strain: 60 },
      { computedAt: "2026-11-06T23:00:00.000Z", freshness: 50, readiness: 60, strain: 70 },
    ]);
    expect(body.delta).toEqual({ freshness: 24.5, readiness: 24.5, strain: 24.5 });
  });

  test("range filters points and drops the delta below two points", async () => {
    const week = await request(`/v1/brains/${historyBrain}/score/history?range=7d`);
    const weekBody = (await expectStatus(week, 200, "GET", HISTORY)) as HistoryBody;
    expect(weekBody.range).toBe("7d");
    expect(weekBody.points).toEqual([
      { computedAt: "2026-11-06T23:00:00.000Z", freshness: 50, readiness: 60, strain: 70 },
    ]);
    expect(weekBody.delta).toBeNull();

    const quarter = await request(`/v1/brains/${historyBrain}/score/history?range=90d`);
    const quarterBody = (await expectStatus(quarter, 200, "GET", HISTORY)) as HistoryBody;
    expect(quarterBody.range).toBe("90d");
    expect(quarterBody.points.map((point) => point.computedAt)).toEqual([
      "2026-09-15T10:00:00.000Z",
      "2026-10-18T20:00:00.000Z",
      "2026-10-28T08:00:00.000Z",
      "2026-11-06T23:00:00.000Z",
    ]);
    expect(quarterBody.delta).toEqual({ freshness: 40, readiness: 40, strain: 40 });

    const invalid = await request(`/v1/brains/${historyBrain}/score/history?range=1d`);
    await expectStatus(invalid, 400, "GET", HISTORY);
  });

  test("a strained brain lists the expected actions in priority then key order", async () => {
    const response = await request(`/v1/brains/${strainedBrain}/score/suggestions`, {
      method: "POST",
    });
    const body = (await expectStatus(response, 200, "POST", SUGGESTIONS)) as SuggestionsBody;
    expect(Object.keys(body).sort()).toEqual(["basedOn", "generatedBy", "items"]);
    expect(body.generatedBy).toBe("rules");
    expect(body.basedOn).toBe("2026-11-06T12:00:00.000Z");
    expect(body.items.map((item) => item.key)).toEqual(STRAINED_KEYS);
    expect(body.items.map((item) => item.priority)).toEqual([
      "high",
      "high",
      "medium",
      "medium",
      "medium",
      "low",
    ]);
    expect(body.items.map((item) => item.action)).toEqual([
      "resolve_contested_pages",
      "retry_failed_sources",
      "capture_input",
      "review_changes",
      "review_connections",
      "fill_profile",
    ]);
    for (const item of body.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.actionLabel.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  test("a healthy brain gets no suggestions", async () => {
    const response = await request(`/v1/brains/${healthyBrain}/score/suggestions`, {
      method: "POST",
    });
    const body = (await expectStatus(response, 200, "POST", SUGGESTIONS)) as SuggestionsBody;
    expect(body.generatedBy).toBe("rules");
    expect(body.basedOn).toBe("2026-11-06T12:00:00.000Z");
    expect(body.items).toEqual([]);
  });

  test("suggestions compute one snapshot when none exists and reuse it afterwards", async () => {
    expect(await snapshotCount(emptyBrain)).toBe(0);

    const first = await request(`/v1/brains/${emptyBrain}/score/suggestions`, { method: "POST" });
    const firstBody = (await expectStatus(first, 200, "POST", SUGGESTIONS)) as SuggestionsBody;
    expect(firstBody.generatedBy).toBe("rules");
    expect(typeof firstBody.basedOn).toBe("string");
    expect(firstBody.items.map((item) => item.key)).toEqual([
      "capture_recent_input",
      "fill_profile",
    ]);
    expect(await snapshotCount(emptyBrain)).toBe(1);

    const second = await request(`/v1/brains/${emptyBrain}/score/suggestions`, { method: "POST" });
    const secondBody = (await expectStatus(second, 200, "POST", SUGGESTIONS)) as SuggestionsBody;
    expect(secondBody.basedOn).toBe(firstBody.basedOn);
    expect(secondBody.items).toEqual(firstBody.items);
    expect(await snapshotCount(emptyBrain)).toBe(1);
  });

  test("a viewer key may read history and request suggestions", async () => {
    await expectStatus(
      await request(`/v1/brains/${historyBrain}/score/history?range=7d`, { key: viewerKey }),
      200,
      "GET",
      HISTORY,
    );
    await expectStatus(
      await request(`/v1/brains/${historyBrain}/score/suggestions`, {
        key: viewerKey,
        method: "POST",
      }),
      200,
      "POST",
      SUGGESTIONS,
    );
  });

  test("foreign tenants, subjects and unknown brains answer 404 without writing", async () => {
    expect(await snapshotCount(hiddenBrain)).toBe(0);

    for (const [path, method, template] of [
      [`/v1/brains/${historyBrain}/score/history`, "GET", HISTORY],
      [`/v1/brains/${historyBrain}/score/suggestions`, "POST", SUGGESTIONS],
    ] as const) {
      const options = method === "POST" ? { method } : {};
      await expectStatus(
        await request(path, { ...options, key: harness.keys.b }),
        404,
        method,
        template,
      );
      await expectStatus(
        await request(path, { ...options, subject: harness.subjects.b }),
        404,
        method,
        template,
      );
    }

    await expectStatus(
      await request(`/v1/brains/${hiddenBrain}/score/suggestions`, { method: "POST" }),
      404,
      "POST",
      SUGGESTIONS,
    );
    await expectStatus(
      await request(`/v1/brains/${hiddenBrain}/score/history`),
      404,
      "GET",
      HISTORY,
    );
    expect(await snapshotCount(hiddenBrain)).toBe(0);
  });
});
