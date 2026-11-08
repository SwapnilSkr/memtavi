import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

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

interface PageBody {
  id: string;
  slug: string;
  deletionState: string;
}

interface VersionBody {
  id: string;
  pageId: string;
  version: number;
  title: string;
  summary: string;
  body: string;
  ingestSourceId: string | null;
  actor: string;
  createdAt: string;
}

interface SourceBody {
  id: string;
  brainId: string;
  contentPreview: string;
  contentUrl: string | null;
  deletedAt: string | null;
}

interface ConnectionBody {
  id: string;
  brainId: string;
  pageAId: string;
  pageBId: string;
  similarity: number;
  strength: string;
  reasoning: string;
  source: string;
  ackedAt: string | null;
}

interface ExportBody {
  brain: BrainBody;
  pages: PageBody[];
  versions: VersionBody[];
  sources: SourceBody[];
  connections: ConnectionBody[];
}

interface DeletionReceiptBody {
  id: string;
  targetType: string;
  state: string;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-08T00:00:00.000Z");
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

describe.skipIf(!ownerUrl || !appUrl)("export bundle and permanent page delete", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `export-${crypto.randomUUID()}`;
  const slugB = `export-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const subjectC = crypto.randomUUID();
  const keys = new Map<string, string>();
  let tenantA: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let exportBrain: string;
  let deleteBrain: string;
  let otherSubjectBrain: string;
  let foreignBrain: string;
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  let alpha: string;
  let beta: string;
  let gone: string;
  let activeSource: string;
  let removedSource: string;
  let exportConnection: string;
  let exportVersions: { pageId: string; version: number }[] = [];

  let target: string;
  let otherOne: string;
  let otherTwo: string;
  let sharedSource: string;
  let survivorConnection: string;

  function request(
    path: string,
    options: { key?: string; subject?: string | null; method?: string } = {},
  ) {
    const headers = new Headers();
    headers.set("x-api-key", options.key ?? keys.get("owner") ?? "");
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subjectA);
    return app.handle(
      new Request(`http://localhost${path}`, { method: options.method ?? "GET", headers }),
    );
  }

  function deletePage(brainId: string, slug: string, permanent?: string) {
    const query = permanent === undefined ? "" : `?permanent=${permanent}`;
    return request(`/v1/brains/${brainId}/pages/${slug}${query}`, { method: "DELETE" });
  }

  async function createBrain(key: string, subject: string, name: string): Promise<string> {
    const headers = new Headers({ "content-type": "application/json" });
    headers.set("x-api-key", key);
    headers.set("x-subject-id", subject);
    const created = await app.handle(
      new Request("http://localhost/v1/brains", {
        method: "POST",
        headers,
        body: JSON.stringify({ name, slug: `${name}-${crypto.randomUUID()}` }),
      }),
    );
    expect(created.status).toBe(201);
    return ((await created.json()) as BrainBody).id;
  }

  async function seedPage(
    brainId: string,
    subject: string,
    input: { slug: string; title?: string; deletionState?: string },
  ): Promise<string> {
    const id = newId("page");
    await owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, bucket,
          status, pinned, archived, content_hash, deletion_state)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', 'topic', 'inbox', 'active', false, false, $7, $8)`,
      [
        id,
        tenantA,
        subject,
        brainId,
        input.slug,
        input.title ?? input.slug,
        `hash-${input.slug}`,
        input.deletionState ?? "active",
      ],
    );
    return id;
  }

  async function seedSource(brainId: string, subject: string, deleted: boolean): Promise<string> {
    const id = newId("source");
    await owner.query(
      `INSERT INTO ingest_sources
         (id, tenant_id, subject_id, brain_id, kind, content, content_hash, deleted_at)
       VALUES ($1, $2, $3, $4, 'note', 'preview text', $5, $6)`,
      [id, tenantA, subject, brainId, `hash-${id}`, deleted ? fixedNow : null],
    );
    return id;
  }

  async function seedVersion(
    pageId: string,
    version: number,
    sourceId: string | null,
  ): Promise<void> {
    await owner.query(
      `INSERT INTO page_versions
         (tenant_id, page_id, version, title, summary, body, ingest_source_id, actor)
       VALUES ($1, $2, $3, $4, '', '', $5, 'compiler')`,
      [tenantA, pageId, version, `Version ${version}`, sourceId],
    );
  }

  async function seedPageSource(pageId: string, sourceId: string): Promise<void> {
    await owner.query(
      "INSERT INTO page_sources (tenant_id, page_id, ingest_source_id) VALUES ($1, $2, $3)",
      [tenantA, pageId, sourceId],
    );
  }

  async function seedEmbedding(pageId: string): Promise<void> {
    const zeros = JSON.stringify(Array.from({ length: 1536 }, () => 0));
    await owner.query(
      `INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash)
       VALUES ($1, $2, 'fixture', 1536, $3::vector, $4)`,
      [tenantA, pageId, zeros, `hash-${pageId}`],
    );
  }

  async function seedBrief(brainId: string, pageId: string, forDate: string): Promise<void> {
    await owner.query(
      "INSERT INTO briefs (tenant_id, brain_id, page_id, for_date) VALUES ($1, $2, $3, $4)",
      [tenantA, brainId, pageId, forDate],
    );
  }

  async function seedChange(brainId: string, pageId: string): Promise<string> {
    const id = newId("change");
    await owner.query(
      `INSERT INTO change_events
         (id, tenant_id, brain_id, page_id, action, change_summary, to_version)
       VALUES ($1, $2, $3, $4, 'created', 'Seeded', 1)`,
      [id, tenantA, brainId, pageId],
    );
    return id;
  }

  async function seedConnection(
    brainId: string,
    left: string,
    right: string,
    similarity: number,
  ): Promise<string> {
    const [pageAId = left, pageBId = right] = [left, right].sort();
    const id = newId("connection");
    await owner.query(
      `INSERT INTO connections
         (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'strong', 'Seeded link', 'auto')`,
      [id, tenantA, brainId, pageAId, pageBId, similarity],
    );
    return id;
  }

  async function countRows(table: string, where: string, values: unknown[]): Promise<number> {
    const result = await owner.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM ${table} WHERE ${where}`,
      values,
    );
    return result.rows[0]?.total ?? 0;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Export fixtures require a disposable memtavi_test database");
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
    keys.set("owner", await bootstrap(owner, "Export A", slugA));
    keys.set("foreign", await bootstrap(owner, "Export B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";

    exportBrain = await createBrain(keys.get("owner") ?? "", subjectA, "export");
    deleteBrain = await createBrain(keys.get("owner") ?? "", subjectA, "delete");
    otherSubjectBrain = await createBrain(keys.get("owner") ?? "", subjectB, "other-subject");
    foreignBrain = await createBrain(keys.get("foreign") ?? "", subjectC, "foreign");

    beta = await seedPage(exportBrain, subjectA, { slug: "beta", title: "Beta" });
    alpha = await seedPage(exportBrain, subjectA, { slug: "alpha", title: "Alpha" });
    gone = await seedPage(exportBrain, subjectA, {
      slug: "gone",
      title: "Gone",
      deletionState: "deleted",
    });
    activeSource = await seedSource(exportBrain, subjectA, false);
    removedSource = await seedSource(exportBrain, subjectA, true);
    await seedVersion(alpha, 2, activeSource);
    await seedVersion(alpha, 1, null);
    await seedVersion(beta, 1, activeSource);
    await seedVersion(gone, 1, removedSource);
    exportConnection = await seedConnection(exportBrain, alpha, beta, 0.8);
    exportVersions = [
      { pageId: alpha, version: 1 },
      { pageId: alpha, version: 2 },
      { pageId: beta, version: 1 },
    ].sort((left, right) =>
      left.pageId !== right.pageId
        ? left.pageId < right.pageId
          ? -1
          : 1
        : left.version - right.version,
    );

    target = await seedPage(deleteBrain, subjectA, { slug: "target", title: "Target" });
    otherOne = await seedPage(deleteBrain, subjectA, { slug: "other-one", title: "Other One" });
    otherTwo = await seedPage(deleteBrain, subjectA, { slug: "other-two", title: "Other Two" });
    sharedSource = await seedSource(deleteBrain, subjectA, false);
    await seedPageSource(target, sharedSource);
    await seedPageSource(otherOne, sharedSource);
    await seedVersion(target, 1, sharedSource);
    await seedVersion(target, 2, sharedSource);
    await seedVersion(otherOne, 1, sharedSource);
    await seedEmbedding(target);
    await seedBrief(deleteBrain, target, "2026-02-01");
    await seedChange(deleteBrain, target);
    await seedConnection(deleteBrain, target, otherOne, 0.9);
    await seedConnection(deleteBrain, target, otherTwo, 0.7);
    survivorConnection = await seedConnection(deleteBrain, otherTwo, otherOne, 0.6);
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

  test("export and permanent delete are 404 for a foreign tenant or another subject", async () => {
    for (const [brainId, options] of [
      [foreignBrain, { key: keys.get("foreign") ?? "" }],
      [otherSubjectBrain, {}],
    ] as const) {
      const response = await request(`/v1/brains/${brainId}/export`, options);
      expect(response.status).toBe(404);
      matchesContract(response, await response.json(), "/v1/brains/{brainId}/export", "get");
    }
    const missing = await request(`/v1/brains/brn_${"0".repeat(32)}/export`);
    expect(missing.status).toBe(404);
    matchesContract(missing, await missing.json(), "/v1/brains/{brainId}/export", "get");

    const foreign = await deletePage(foreignBrain, "target", "true");
    expect(foreign.status).toBe(404);
    matchesContract(foreign, await foreign.json(), "/v1/brains/{brainId}/pages/{slug}", "delete");
    expect(
      await countRows("deletion_ops", "tenant_id = $1 AND target_id = $2", [tenantA, target]),
    ).toBe(0);
  });

  test("export returns the brain, its live pages, versions, live sources and connections", async () => {
    const response = await request(`/v1/brains/${exportBrain}/export`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ExportBody;
    matchesContract(response, body, "/v1/brains/{brainId}/export", "get");

    expect(body.brain).toMatchObject({
      id: exportBrain,
      subjectId: subjectA,
      name: "export",
      deletionState: "active",
    });
    expect(Object.keys(body.brain).sort()).toEqual([
      "briefSettings",
      "createdAt",
      "deletionState",
      "description",
      "id",
      "name",
      "projectId",
      "slug",
      "subjectId",
      "updatedAt",
    ]);

    expect(body.pages.map((page) => page.slug)).toEqual(["alpha", "beta"]);
    expect(body.pages.every((page) => page.deletionState === "active")).toBe(true);
    expect(body.pages.some((page) => page.id === gone)).toBe(false);

    expect(body.versions.map((version) => `${version.pageId}:${version.version}`)).toEqual(
      exportVersions.map((version) => `${version.pageId}:${version.version}`),
    );
    expect(Object.keys(body.versions[0] ?? {}).sort()).toEqual([
      "actor",
      "body",
      "createdAt",
      "id",
      "ingestSourceId",
      "pageId",
      "summary",
      "title",
      "version",
    ]);
    expect(body.versions.some((version) => version.pageId === gone)).toBe(false);

    expect(body.sources.map((source) => source.id)).toEqual([activeSource]);
    expect(body.sources[0]?.contentUrl).toBeNull();
    expect(body.sources[0]?.deletedAt).toBeNull();
    expect(body.sources.some((source) => source.id === removedSource)).toBe(false);

    expect(body.connections.map((connection) => connection.id)).toEqual([exportConnection]);
    expect(body.connections[0]).toMatchObject({
      brainId: exportBrain,
      similarity: 0.8,
      strength: "strong",
      reasoning: "Seeded link",
      source: "auto",
      ackedAt: null,
    });
  });

  test("export is deterministic across repeated reads", async () => {
    const first = await request(`/v1/brains/${exportBrain}/export`);
    const second = await request(`/v1/brains/${exportBrain}/export`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as ExportBody;
    const secondBody = (await second.json()) as ExportBody;
    expect(secondBody.pages.map((page) => page.id)).toEqual(firstBody.pages.map((page) => page.id));
    expect(secondBody.versions.map((version) => version.id)).toEqual(
      firstBody.versions.map((version) => version.id),
    );
    expect(secondBody.sources.map((source) => source.id)).toEqual(
      firstBody.sources.map((source) => source.id),
    );
    expect(secondBody.connections.map((connection) => connection.id)).toEqual(
      firstBody.connections.map((connection) => connection.id),
    );
  });

  test("a delete without permanent=true is a 400 and leaves the page in place", async () => {
    for (const permanent of [undefined, "false", "1"] as const) {
      const response = await deletePage(deleteBrain, "target", permanent);
      expect(response.status).toBe(400);
      matchesContract(
        response,
        await response.json(),
        "/v1/brains/{brainId}/pages/{slug}",
        "delete",
      );
      expect(await countRows("pages", "tenant_id = $1 AND id = $2", [tenantA, target])).toBe(1);
    }
  });

  test("permanent delete cascades and records a receipt plus a deletion_ops row", async () => {
    const response = await deletePage(deleteBrain, "target", "true");
    expect(response.status).toBe(202);
    const receipt = (await response.json()) as DeletionReceiptBody;
    matchesContract(response, receipt, "/v1/brains/{brainId}/pages/{slug}", "delete");
    expect(receipt).toEqual({ id: target, targetType: "page", state: "deleted" });

    expect(await countRows("pages", "tenant_id = $1 AND id = $2", [tenantA, target])).toBe(0);
    expect(
      await countRows("page_versions", "tenant_id = $1 AND page_id = $2", [tenantA, target]),
    ).toBe(0);
    expect(
      await countRows("page_sources", "tenant_id = $1 AND page_id = $2", [tenantA, target]),
    ).toBe(0);
    expect(
      await countRows("page_embeddings", "tenant_id = $1 AND page_id = $2", [tenantA, target]),
    ).toBe(0);
    expect(await countRows("briefs", "tenant_id = $1 AND page_id = $2", [tenantA, target])).toBe(0);
    expect(
      await countRows("change_events", "tenant_id = $1 AND page_id = $2", [tenantA, target]),
    ).toBe(0);
    expect(
      await countRows("connections", "tenant_id = $1 AND (page_a_id = $2 OR page_b_id = $2)", [
        tenantA,
        target,
      ]),
    ).toBe(0);

    expect(
      await countRows("connections", "tenant_id = $1 AND id = $2", [tenantA, survivorConnection]),
    ).toBe(1);

    expect(
      await countRows("ingest_sources", "tenant_id = $1 AND id = $2", [tenantA, sharedSource]),
    ).toBe(1);
    expect(
      await countRows("page_sources", "tenant_id = $1 AND page_id = $2 AND ingest_source_id = $3", [
        tenantA,
        otherOne,
        sharedSource,
      ]),
    ).toBe(1);
    expect(
      await countRows(
        "page_versions",
        "tenant_id = $1 AND page_id = $2 AND ingest_source_id = $3",
        [tenantA, otherOne, sharedSource],
      ),
    ).toBe(1);
    expect(await countRows("pages", "tenant_id = $1 AND id = $2", [tenantA, otherOne])).toBe(1);

    const ops = await owner.query<{
      id: string;
      target_type: string;
      target_id: string;
      state: string;
      detail: { deletedAt?: string };
    }>(
      `SELECT id, target_type, target_id, state, detail FROM deletion_ops
       WHERE tenant_id = $1 AND brain_id = $2 AND target_id = $3`,
      [tenantA, deleteBrain, target],
    );
    expect(ops.rowCount).toBe(1);
    const op = ops.rows[0];
    expect(op?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op?.target_type).toBe("page");
    expect(op?.target_id).toBe(target);
    expect(op?.state).toBe("deleted");
    expect(typeof op?.detail.deletedAt).toBe("string");
    expect(Number.isNaN(Date.parse(op?.detail.deletedAt ?? ""))).toBe(false);

    const second = await deletePage(deleteBrain, "target", "true");
    expect(second.status).toBe(404);
    matchesContract(second, await second.json(), "/v1/brains/{brainId}/pages/{slug}", "delete");
    expect(
      await countRows("deletion_ops", "tenant_id = $1 AND target_id = $2", [tenantA, target]),
    ).toBe(1);
  });
});
