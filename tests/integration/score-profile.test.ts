import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface ScoreBody {
  brainId: string;
  computedAt: string;
  freshness: number;
  readiness: number;
  strain: number;
  factors: Record<string, unknown>;
}

interface ProfileBody {
  brainId: string;
  whoTheyAre: string;
  whatTheyDo: string;
  focus: string;
  goals: string;
  currentProjects: string;
  stuckOn: string;
  vaultOrganization: string;
  directives: Record<string, unknown>;
}

interface SeedScore {
  id?: string;
  computedAt: string;
  freshness: number;
  readiness: number;
  strain: number;
  factors: Record<string, unknown>;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");
const spec = parse(
  await Bun.file(new URL("../../packages/spec/openapi.yaml", import.meta.url)).text(),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function matchesContract(response: Response, body: unknown, path: string, method: string) {
  const operation = spec.paths[path][method];
  let contract = operation.responses[String(response.status)];
  expect(contract !== undefined).toBe(true);
  if (contract.$ref) contract = spec.components.responses[contract.$ref.split("/").at(-1)];
  expect(response.headers.get("x-request-id")).toBeTruthy();
  if (!contract.content) return;
  const schema = contract.content["application/json"].schema;
  const validate = ajv.compile({ ...schema, components: spec.components });
  expect(validate(body)).toBe(true);
}

describe.skipIf(!ownerUrl || !appUrl)("score and profile over the wire", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `score-${crypto.randomUUID()}`;
  const slugB = `score-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const subjectC = crypto.randomUUID();
  const keys = new Map<string, string>();
  let tenantA: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let scoreBrain: string;
  let tieBrain: string;
  let emptyBrain: string;
  let defaultProfileBrain: string;
  let filledProfileBrain: string;
  let patchBrain: string;
  let otherSubjectBrain: string;
  let foreignBrain: string;
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  function request(
    path: string,
    options: {
      key?: string;
      subject?: string | null;
      method?: string;
      body?: unknown;
    } = {},
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

  async function createBrain(key: string, subject: string, name: string): Promise<string> {
    const created = await request("/v1/brains", {
      key,
      subject,
      method: "POST",
      body: { name, slug: `${name}-${crypto.randomUUID()}` },
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  async function seedScore(brainId: string, snapshot: SeedScore): Promise<void> {
    await owner.query(
      `INSERT INTO score_snapshots
         (id, tenant_id, brain_id, computed_at, freshness, readiness, strain, factors)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)`,
      [
        snapshot.id ?? null,
        tenantA,
        brainId,
        snapshot.computedAt,
        snapshot.freshness,
        snapshot.readiness,
        snapshot.strain,
        snapshot.factors,
      ],
    );
  }

  async function seedProfile(
    brainId: string,
    profile: Omit<ProfileBody, "brainId">,
  ): Promise<void> {
    await owner.query(
      `INSERT INTO profiles
         (brain_id, tenant_id, who_they_are, what_they_do, focus, goals, current_projects,
          stuck_on, vault_organization, directives)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        brainId,
        tenantA,
        profile.whoTheyAre,
        profile.whatTheyDo,
        profile.focus,
        profile.goals,
        profile.currentProjects,
        profile.stuckOn,
        profile.vaultOrganization,
        profile.directives,
      ],
    );
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Score fixtures require a disposable memtavi_test database");
    }
    const appDatabase = await application.query<{
      name: string;
      role: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_database() AS name, current_user AS role, rolsuper, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`,
    );
    expect(appDatabase.rows[0]).toEqual({
      name: database.rows[0]?.name ?? "",
      role: "memtavi_app",
      rolsuper: false,
      rolbypassrls: false,
    });
    fixturesAuthorized = true;
    process.env.APP_DATABASE_URL = appUrl;
    db = await import("@memtavi/db/client");
    app = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => fixedNow,
    });
    keys.set("owner", await bootstrap(owner, "Score A", slugA));
    keys.set("foreign", await bootstrap(owner, "Score B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";

    scoreBrain = await createBrain(keys.get("owner") ?? "", subjectA, "score");
    tieBrain = await createBrain(keys.get("owner") ?? "", subjectA, "tie");
    emptyBrain = await createBrain(keys.get("owner") ?? "", subjectA, "empty");
    defaultProfileBrain = await createBrain(keys.get("owner") ?? "", subjectA, "defaults");
    filledProfileBrain = await createBrain(keys.get("owner") ?? "", subjectA, "filled");
    patchBrain = await createBrain(keys.get("owner") ?? "", subjectA, "patch");
    otherSubjectBrain = await createBrain(keys.get("owner") ?? "", subjectB, "hidden");
    foreignBrain = await createBrain(keys.get("foreign") ?? "", subjectC, "foreign");

    await seedScore(scoreBrain, {
      computedAt: "2026-01-01T00:00:00.000Z",
      freshness: 0.2,
      readiness: 0.3,
      strain: 0.9,
      factors: { pages: 2, note: "older" },
    });
    await seedScore(scoreBrain, {
      computedAt: "2026-03-01T00:00:00.000Z",
      freshness: 0.9,
      readiness: 0.8,
      strain: 0.1,
      factors: { pages: 12, note: "newest" },
    });
    await seedScore(scoreBrain, {
      computedAt: "2026-02-01T00:00:00.000Z",
      freshness: 0.5,
      readiness: 0.5,
      strain: 0.5,
      factors: { pages: 7, note: "middle" },
    });

    await seedScore(tieBrain, {
      id: "00000000-0000-0000-0000-000000000002",
      computedAt: "2026-04-01T00:00:00.000Z",
      freshness: 1,
      readiness: 0.99,
      strain: 0,
      factors: { note: "later id" },
    });
    await seedScore(tieBrain, {
      id: "00000000-0000-0000-0000-000000000001",
      computedAt: "2026-04-01T00:00:00.000Z",
      freshness: 0.1,
      readiness: 0.11,
      strain: 0.2,
      factors: { note: "earlier id" },
    });

    await seedProfile(filledProfileBrain, {
      whoTheyAre: "A systems designer",
      whatTheyDo: "Builds developer tools",
      focus: "Shipping the API",
      goals: "Reach parity",
      currentProjects: "Memtavi",
      stuckOn: "Graph scoring",
      vaultOrganization: "PARA",
      directives: { tone: "direct", depth: 2 },
    });
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

  test("score returns the newest snapshot for the brain", async () => {
    const response = await request(`/v1/brains/${scoreBrain}/score`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ScoreBody;
    matchesContract(response, body, "/v1/brains/{brainId}/score", "get");
    expect(body).toEqual({
      brainId: scoreBrain,
      computedAt: "2026-03-01T00:00:00.000Z",
      freshness: 0.9,
      readiness: 0.8,
      strain: 0.1,
      factors: { pages: 12, note: "newest" },
    });
    expect(Object.keys(body).sort()).toEqual([
      "brainId",
      "computedAt",
      "factors",
      "freshness",
      "readiness",
      "strain",
    ]);
  });

  test("score breaks a computed_at tie by id and 404s when no snapshot exists", async () => {
    const tie = await request(`/v1/brains/${tieBrain}/score`);
    expect(tie.status).toBe(200);
    const tieBody = (await tie.json()) as ScoreBody;
    matchesContract(tie, tieBody, "/v1/brains/{brainId}/score", "get");
    expect(tieBody.readiness).toBe(0.11);
    expect(tieBody.factors).toEqual({ note: "earlier id" });

    const missing = await request(`/v1/brains/${emptyBrain}/score`);
    expect(missing.status).toBe(404);
    matchesContract(missing, await missing.json(), "/v1/brains/{brainId}/score", "get");

    const absent = await request(`/v1/brains/${newId("brain")}/score`);
    expect(absent.status).toBe(404);
  });

  test("profile returns empty defaults for a brain without a row", async () => {
    const response = await request(`/v1/brains/${defaultProfileBrain}/profile`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProfileBody;
    matchesContract(response, body, "/v1/brains/{brainId}/profile", "get");
    expect(body).toEqual({
      brainId: defaultProfileBrain,
      whoTheyAre: "",
      whatTheyDo: "",
      focus: "",
      goals: "",
      currentProjects: "",
      stuckOn: "",
      vaultOrganization: "",
      directives: {},
    });
    expect(Object.keys(body).sort()).toEqual([
      "brainId",
      "currentProjects",
      "directives",
      "focus",
      "goals",
      "stuckOn",
      "vaultOrganization",
      "whatTheyDo",
      "whoTheyAre",
    ]);
  });

  test("profile returns a stored row", async () => {
    const response = await request(`/v1/brains/${filledProfileBrain}/profile`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProfileBody;
    matchesContract(response, body, "/v1/brains/{brainId}/profile", "get");
    expect(body).toEqual({
      brainId: filledProfileBrain,
      whoTheyAre: "A systems designer",
      whatTheyDo: "Builds developer tools",
      focus: "Shipping the API",
      goals: "Reach parity",
      currentProjects: "Memtavi",
      stuckOn: "Graph scoring",
      vaultOrganization: "PARA",
      directives: { tone: "direct", depth: 2 },
    });
  });

  test("a partial PATCH creates the row and changes only supplied fields", async () => {
    const created = await request(`/v1/brains/${patchBrain}/profile`, {
      method: "PATCH",
      body: { whoTheyAre: "Builder", directives: { tone: "direct", depth: 3 } },
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as ProfileBody;
    matchesContract(created, createdBody, "/v1/brains/{brainId}/profile", "patch");
    expect(createdBody).toEqual({
      brainId: patchBrain,
      whoTheyAre: "Builder",
      whatTheyDo: "",
      focus: "",
      goals: "",
      currentProjects: "",
      stuckOn: "",
      vaultOrganization: "",
      directives: { tone: "direct", depth: 3 },
    });

    const patched = await request(`/v1/brains/${patchBrain}/profile`, {
      method: "PATCH",
      body: { focus: "shipping", directives: { tone: "warm" } },
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as ProfileBody;
    matchesContract(patched, patchedBody, "/v1/brains/{brainId}/profile", "patch");
    expect(patchedBody).toEqual({
      brainId: patchBrain,
      whoTheyAre: "Builder",
      whatTheyDo: "",
      focus: "shipping",
      goals: "",
      currentProjects: "",
      stuckOn: "",
      vaultOrganization: "",
      directives: { tone: "warm" },
    });

    const stored = await owner.query<{
      who_they_are: string;
      focus: string;
      directives: Record<string, unknown>;
    }>(
      "SELECT who_they_are, focus, directives FROM profiles WHERE tenant_id = $1 AND brain_id = $2",
      [tenantA, patchBrain],
    );
    expect(stored.rows[0]).toEqual({
      who_they_are: "Builder",
      focus: "shipping",
      directives: { tone: "warm" },
    });
    expect(stored.rowCount).toBe(1);
  });

  test("directives round-trip as an object", async () => {
    const patched = await request(`/v1/brains/${patchBrain}/profile`, {
      method: "PATCH",
      body: { directives: { voice: "terse", limits: { pages: 4, tags: ["a", "b"] } } },
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as ProfileBody;
    matchesContract(patched, patchedBody, "/v1/brains/{brainId}/profile", "patch");
    expect(patchedBody.directives).toEqual({
      voice: "terse",
      limits: { pages: 4, tags: ["a", "b"] },
    });

    const read = await request(`/v1/brains/${patchBrain}/profile`);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as ProfileBody;
    matchesContract(read, readBody, "/v1/brains/{brainId}/profile", "get");
    expect(readBody.directives).toEqual({
      voice: "terse",
      limits: { pages: 4, tags: ["a", "b"] },
    });
  });

  test("every endpoint 404s for a foreign brain", async () => {
    for (const [path, contractPath, method] of [
      [`/v1/brains/${foreignBrain}/score`, "/v1/brains/{brainId}/score", "get"],
      [`/v1/brains/${foreignBrain}/profile`, "/v1/brains/{brainId}/profile", "get"],
      [`/v1/brains/${otherSubjectBrain}/score`, "/v1/brains/{brainId}/score", "get"],
      [`/v1/brains/${otherSubjectBrain}/profile`, "/v1/brains/{brainId}/profile", "get"],
    ] as const) {
      const response = await request(path);
      expect(response.status).toBe(404);
      matchesContract(response, await response.json(), contractPath, method);
    }

    const foreignScore = await request(`/v1/brains/${foreignBrain}/score`, {
      key: keys.get("foreign") ?? "",
      subject: subjectC,
    });
    expect(foreignScore.status).toBe(404);

    for (const path of [
      `/v1/brains/${foreignBrain}/profile`,
      `/v1/brains/${otherSubjectBrain}/profile`,
    ]) {
      const response = await request(path, {
        method: "PATCH",
        body: { whoTheyAre: "intruder" },
      });
      expect(response.status).toBe(404);
      matchesContract(response, await response.json(), "/v1/brains/{brainId}/profile", "patch");
    }

    const rows = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM profiles WHERE brain_id = ANY($1::text[])",
      [[foreignBrain, otherSubjectBrain]],
    );
    expect(rows.rows[0]?.total).toBe(0);

    const absent = await request(`/v1/brains/${newId("brain")}/profile`);
    expect(absent.status).toBe(404);
  });

  test("invalid profile bodies are rejected with the error envelope", async () => {
    for (const body of [{ whoTheyAre: 5 }, { directives: null }]) {
      const response = await request(`/v1/brains/${patchBrain}/profile`, {
        method: "PATCH",
        body,
      });
      expect(response.status).toBe(400);
      matchesContract(response, await response.json(), "/v1/brains/{brainId}/profile", "patch");
    }
  });
});
