import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createFakeStore } from "@memtavi/storage/fake";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";
import { issueKey } from "../../apps/api/src/lib/keys";

interface BrainBody {
  id: string;
  subjectId: string;
  projectId: string | null;
  name: string;
  slug: string;
  description: string;
  briefSettings: Record<string, unknown>;
  deletionState: string;
  createdAt: string;
  updatedAt: string;
}

interface ErrorBody {
  message: string;
  body: { message: string; error: string; statusCode: number };
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

describe.skipIf(!ownerUrl || !appUrl)("brain updates", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `brain-a-${crypto.randomUUID()}`;
  const slugB = `brain-b-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const keys = new Map<string, string>();
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  let projectA: string;
  let projectB: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  function request(
    path: string,
    options: {
      key?: string | undefined;
      subject?: string | null;
      method?: string;
      body?: unknown;
    } = {},
  ) {
    const headers = new Headers();
    const key = options.key === undefined ? keys.get("owner") : options.key;
    if (key !== undefined) headers.set("x-api-key", key);
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

  async function createBrain(
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<BrainBody> {
    const response = await request("/v1/brains", {
      method: "POST",
      body: { name, slug: `brain-${crypto.randomUUID()}`, ...extra },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as BrainBody;
  }

  async function storedRow(brainId: string): Promise<Record<string, unknown> | undefined> {
    const result = await owner.query<{ row: Record<string, unknown> }>(
      "SELECT to_jsonb(t) AS row FROM brains t WHERE id = $1",
      [brainId],
    );
    return result.rows[0]?.row;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Brain fixtures require a disposable memtavi_test database");
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
    keys.set("owner", await bootstrap(owner, "Brain A", slugA));
    keys.set("foreign", await bootstrap(owner, "Brain B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";
    tenantB = tenants.rows.find((row) => row.slug === slugB)?.id ?? "";
    const actors = await owner.query<{ tenant_id: string; created_by: string }>(
      "SELECT tenant_id, created_by FROM api_keys WHERE tenant_id = ANY($1::uuid[])",
      [[tenantA, tenantB]],
    );
    userA = actors.rows.find((row) => row.tenant_id === tenantA)?.created_by ?? "";
    userB = actors.rows.find((row) => row.tenant_id === tenantB)?.created_by ?? "";
    for (const role of ["viewer", "developer"] as const) {
      const issued = issueKey();
      keys.set(role, issued.key);
      await owner.query(
        `INSERT INTO api_keys (tenant_id, created_by, name, prefix, key_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantA, userA, `brain ${role}`, issued.prefix, issued.hash, role],
      );
    }
    projectA = crypto.randomUUID();
    projectB = crypto.randomUUID();
    await owner.query(
      `INSERT INTO projects (id, tenant_id, owner_user_id, name, slug, kind)
       VALUES ($1, $2, $3, 'Brain project A', 'brain-project-a', 'standard'),
              ($4, $5, $6, 'Brain project B', 'brain-project-b', 'standard')`,
      [projectA, tenantA, userA, projectB, tenantB, userB],
    );
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

  test("renaming changes the name, keeps the slug and advances updatedAt", async () => {
    const brain = await createBrain("Rename source");
    const response = await request(`/v1/brains/${brain.id}`, {
      method: "PATCH",
      body: { name: "Renamed brain" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BrainBody;
    matchesContract(response, body, "/v1/brains/{brainId}", "patch");
    expect(body.id).toBe(brain.id);
    expect(body.name).toBe("Renamed brain");
    expect(body.slug).toBe(brain.slug);
    expect(body.description).toBe(brain.description);
    expect(body.projectId).toBeNull();
    expect(body.briefSettings).toEqual({});
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(new Date(brain.updatedAt).getTime());
    const stored = await storedRow(brain.id);
    expect(stored?.name).toBe("Renamed brain");
    expect(stored?.slug).toBe(brain.slug);
  });

  test("a description update leaves the name alone", async () => {
    const brain = await createBrain("Description source", { description: "Before" });
    const response = await request(`/v1/brains/${brain.id}`, {
      method: "PATCH",
      body: { description: "After" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BrainBody;
    matchesContract(response, body, "/v1/brains/{brainId}", "patch");
    expect(body.description).toBe("After");
    expect(body.name).toBe("Description source");
    expect(body.slug).toBe(brain.slug);
    expect((await storedRow(brain.id))?.description).toBe("After");
  });

  test("a project can be set and cleared", async () => {
    const brain = await createBrain("Project source");
    const set = await request(`/v1/brains/${brain.id}`, {
      method: "PATCH",
      body: { projectId: projectA },
    });
    expect(set.status).toBe(200);
    const setBody = (await set.json()) as BrainBody;
    matchesContract(set, setBody, "/v1/brains/{brainId}", "patch");
    expect(setBody.projectId).toBe(projectA);
    expect((await storedRow(brain.id))?.project_id).toBe(projectA);

    const cleared = await request(`/v1/brains/${brain.id}`, {
      method: "PATCH",
      body: { projectId: null },
    });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as BrainBody;
    matchesContract(cleared, clearedBody, "/v1/brains/{brainId}", "patch");
    expect(clearedBody.projectId).toBeNull();
    expect((await storedRow(brain.id))?.project_id).toBeNull();
  });

  test("brief settings are replaced rather than merged", async () => {
    const brain = await createBrain("Settings source", {
      briefSettings: { enabled: true, mode: "quick" },
    });
    const response = await request(`/v1/brains/${brain.id}`, {
      method: "PATCH",
      body: { briefSettings: { mode: "deep" } },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BrainBody;
    matchesContract(response, body, "/v1/brains/{brainId}", "patch");
    expect(body.briefSettings).toEqual({ mode: "deep" });
    expect((await storedRow(brain.id))?.brief_settings).toEqual({ mode: "deep" });
  });

  test("an empty body returns the brain unchanged and writes nothing", async () => {
    const brain = await createBrain("Empty source", { description: "Stays" });
    const before = await storedRow(brain.id);
    const response = await request(`/v1/brains/${brain.id}`, {
      method: "PATCH",
      body: {},
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BrainBody;
    matchesContract(response, body, "/v1/brains/{brainId}", "patch");
    expect(body).toEqual(brain);
    expect(await storedRow(brain.id)).toEqual(before);
  });

  test("a foreign or unknown project is a 400 and changes nothing", async () => {
    const brain = await createBrain("Invalid project source");
    for (const projectId of [projectB, crypto.randomUUID()]) {
      const before = await storedRow(brain.id);
      const response = await request(`/v1/brains/${brain.id}`, {
        method: "PATCH",
        body: { projectId },
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorBody;
      expect(body.message).toBe("Invalid project id");
      matchesContract(response, body, "/v1/brains/{brainId}", "patch");
      expect(await storedRow(brain.id)).toEqual(before);
    }
  });

  test("a viewer is forbidden and a developer is allowed", async () => {
    const brain = await createBrain("Role source");
    const before = await storedRow(brain.id);
    const denied = await request(`/v1/brains/${brain.id}`, {
      key: keys.get("viewer"),
      method: "PATCH",
      body: { name: "Denied" },
    });
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as ErrorBody;
    expect(deniedBody.message).toBe("Forbidden");
    matchesContract(denied, deniedBody, "/v1/brains/{brainId}", "patch");
    expect(await storedRow(brain.id)).toEqual(before);

    const accepted = await request(`/v1/brains/${brain.id}`, {
      key: keys.get("developer"),
      method: "PATCH",
      body: { name: "Developer rename" },
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as BrainBody;
    matchesContract(accepted, acceptedBody, "/v1/brains/{brainId}", "patch");
    expect(acceptedBody.name).toBe("Developer rename");
  });

  test("another tenant's brain and another subject's brain are 404 and unchanged", async () => {
    const brain = await createBrain("Hidden source");
    const before = await storedRow(brain.id);
    const foreign = await request(`/v1/brains/${brain.id}`, {
      key: keys.get("foreign"),
      method: "PATCH",
      body: { name: "Stolen" },
    });
    expect(foreign.status).toBe(404);
    const foreignBody = (await foreign.json()) as ErrorBody;
    expect(foreignBody.message).toBe("Not found");
    matchesContract(foreign, foreignBody, "/v1/brains/{brainId}", "patch");
    expect(await storedRow(brain.id)).toEqual(before);

    const otherSubject = await request(`/v1/brains/${brain.id}`, {
      subject: subjectB,
      method: "PATCH",
      body: { name: "Stolen" },
    });
    expect(otherSubject.status).toBe(404);
    matchesContract(otherSubject, await otherSubject.json(), "/v1/brains/{brainId}", "patch");
    expect(await storedRow(brain.id)).toEqual(before);

    const missing = await request(`/v1/brains/brn_${"0".repeat(32)}`, {
      method: "PATCH",
      body: { name: "Missing" },
    });
    expect(missing.status).toBe(404);
    matchesContract(missing, await missing.json(), "/v1/brains/{brainId}", "patch");
  });

  test("a malformed body is a 400 through the validation middleware", async () => {
    const brain = await createBrain("Validation source");
    const cases: unknown[] = [{ name: "" }, { name: "x".repeat(201) }, { projectId: "not-a-uuid" }];
    for (const body of cases) {
      const response = await request(`/v1/brains/${brain.id}`, { method: "PATCH", body });
      expect(response.status).toBe(400);
      const error = (await response.json()) as ErrorBody;
      expect(error.message).toBe("Invalid request");
      matchesContract(response, error, "/v1/brains/{brainId}", "patch");
    }
  });
});
