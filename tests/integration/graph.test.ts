import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

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

interface GraphNodeBody {
  id: string;
  slug: string;
  title: string;
  pageType: string;
  bucket: string;
  status: string;
  pinned: boolean;
}

interface GraphEdgeBody {
  connectionId: string;
  pageAId: string;
  pageBId: string;
  similarity: number;
  strength: string;
  source: string;
}

interface GraphBody {
  nodes: GraphNodeBody[];
  edges: GraphEdgeBody[];
}

interface ListBody<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface SeedPage {
  slug: string;
  title?: string;
  pageType?: string;
  bucket?: string;
  status?: string;
  pinned?: boolean;
  archived?: boolean;
  deletionState?: string;
}

interface SeedConnection {
  a: string;
  b: string;
  similarity: number;
  strength: string;
  reasoning?: string;
  source?: string;
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

describe.skipIf(!ownerUrl || !appUrl)("graph and connections over the wire", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `graph-${crypto.randomUUID()}`;
  const slugB = `graph-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const subjectC = crypto.randomUUID();
  const keys = new Map<string, string>();
  let tenantA: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let graphBrain: string;
  let otherSubjectBrain: string;
  let foreignBrain: string;
  let alpha: string;
  let beta: string;
  let delta: string;
  let gamma: string;
  let stalePage: string;
  let archivedPage: string;
  let deletedPage: string;
  let otherPage: string;
  let otherSubjectPage: string;
  let liveStrong: string;
  let liveMedium: string;
  let liveWeak: string;
  let tieA: string;
  let staleEdge: string;
  let archivedEdge: string;
  let deletedEdge: string;
  let otherEdge: string;
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

  async function seedPage(brainId: string, subject: string, page: SeedPage): Promise<string> {
    const id = newId("page");
    await owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, bucket,
          status, pinned, archived, content_hash, deletion_state)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        tenantA,
        subject,
        brainId,
        page.slug,
        page.title ?? page.slug,
        page.pageType ?? "topic",
        page.bucket ?? "inbox",
        page.status ?? "active",
        page.pinned ?? false,
        page.archived ?? false,
        `seed-${page.slug}`,
        page.deletionState ?? "active",
      ],
    );
    return id;
  }

  async function seedConnection(brainId: string, link: SeedConnection): Promise<string> {
    const [pageAId, pageBId] = canonical(link);
    const id = newId("connection");
    await owner.query(
      `INSERT INTO connections
         (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        tenantA,
        brainId,
        pageAId,
        pageBId,
        link.similarity,
        link.strength,
        link.reasoning ?? `seed-${link.similarity}`,
        link.source ?? "auto",
      ],
    );
    return id;
  }

  function canonical(link: { a: string; b: string }): [string, string] {
    const [pageAId = link.a, pageBId = link.b] = [link.a, link.b].sort();
    return [pageAId, pageBId];
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Graph fixtures require a disposable memtavi_test database");
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
    keys.set("owner", await bootstrap(owner, "Graph A", slugA));
    keys.set("foreign", await bootstrap(owner, "Graph B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";

    graphBrain = await createBrain(keys.get("owner") ?? "", subjectA, "graph");
    otherSubjectBrain = await createBrain(keys.get("owner") ?? "", subjectB, "other");
    foreignBrain = await createBrain(keys.get("foreign") ?? "", subjectC, "foreign");

    alpha = await seedPage(graphBrain, subjectA, {
      slug: "alpha",
      title: "Alpha",
      pageType: "topic",
      bucket: "notes",
    });
    beta = await seedPage(graphBrain, subjectA, {
      slug: "beta",
      title: "Beta",
      pageType: "entity",
      bucket: "projects",
      status: "contested",
      pinned: true,
    });
    delta = await seedPage(graphBrain, subjectA, { slug: "delta", title: "Delta" });
    gamma = await seedPage(graphBrain, subjectA, {
      slug: "gamma",
      title: "Gamma",
      pageType: "decision",
      bucket: "ideas",
    });
    stalePage = await seedPage(graphBrain, subjectA, { slug: "stale", status: "stale" });
    archivedPage = await seedPage(graphBrain, subjectA, { slug: "archived", archived: true });
    deletedPage = await seedPage(graphBrain, subjectA, { slug: "gone", deletionState: "deleted" });
    otherPage = await seedPage(otherSubjectBrain, subjectB, { slug: "elsewhere" });
    otherSubjectPage = await seedPage(otherSubjectBrain, subjectB, { slug: "hidden" });

    liveStrong = await seedConnection(graphBrain, {
      a: alpha,
      b: beta,
      similarity: 0.91,
      strength: "strong",
      reasoning: "Alpha and beta overlap",
      source: "auto",
    });
    liveMedium = await seedConnection(graphBrain, {
      a: beta,
      b: gamma,
      similarity: 0.72,
      strength: "medium",
      reasoning: "Beta and gamma overlap",
      source: "manual",
    });
    liveWeak = await seedConnection(graphBrain, {
      a: alpha,
      b: gamma,
      similarity: 0.42,
      strength: "weak",
      source: "auto",
    });
    tieA = await seedConnection(graphBrain, {
      a: alpha,
      b: delta,
      similarity: 0.72,
      strength: "medium",
      source: "auto",
    });
    staleEdge = await seedConnection(graphBrain, {
      a: alpha,
      b: stalePage,
      similarity: 0.99,
      strength: "strong",
    });
    archivedEdge = await seedConnection(graphBrain, {
      a: beta,
      b: archivedPage,
      similarity: 0.88,
      strength: "strong",
    });
    deletedEdge = await seedConnection(graphBrain, {
      a: gamma,
      b: deletedPage,
      similarity: 0.77,
      strength: "medium",
    });
    otherEdge = await seedConnection(otherSubjectBrain, {
      a: otherPage,
      b: otherSubjectPage,
      similarity: 0.95,
      strength: "strong",
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

  test("the graph returns live nodes of this brain and only edges between them", async () => {
    const response = await request(`/v1/brains/${graphBrain}/graph`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as GraphBody;
    matchesContract(response, body, "/v1/brains/{brainId}/graph", "get");

    expect(body.nodes.map((node) => node.id)).toEqual([alpha, beta, delta, gamma]);
    expect(Object.keys(body.nodes[0] ?? {}).sort()).toEqual([
      "bucket",
      "id",
      "pageType",
      "pinned",
      "slug",
      "status",
      "title",
    ]);
    expect(body.nodes[0]).toEqual({
      id: alpha,
      slug: "alpha",
      title: "Alpha",
      pageType: "topic",
      bucket: "notes",
      status: "active",
      pinned: false,
    });
    expect(body.nodes[1]).toEqual({
      id: beta,
      slug: "beta",
      title: "Beta",
      pageType: "entity",
      bucket: "projects",
      status: "contested",
      pinned: true,
    });

    const nodeIds = new Set(body.nodes.map((node) => node.id));
    for (const nodeId of [stalePage, archivedPage, deletedPage, otherPage, otherSubjectPage]) {
      expect(nodeIds.has(nodeId)).toBe(false);
    }

    const requested = [
      { connectionId: liveStrong, link: { a: alpha, b: beta } },
      { connectionId: liveMedium, link: { a: beta, b: gamma } },
      { connectionId: liveWeak, link: { a: alpha, b: gamma } },
      { connectionId: tieA, link: { a: alpha, b: delta } },
    ].sort((left, right) => {
      const [a1, b1] = canonical(left.link);
      const [a2, b2] = canonical(right.link);
      if (a1 !== a2) return a1 < a2 ? -1 : 1;
      return b1 < b2 ? -1 : b1 > b2 ? 1 : 0;
    });
    expect(body.edges.map((edge) => edge.connectionId)).toEqual(
      requested.map((entry) => entry.connectionId),
    );
    for (const edge of body.edges) {
      expect(nodeIds.has(edge.pageAId)).toBe(true);
      expect(nodeIds.has(edge.pageBId)).toBe(true);
      expect(Object.keys(edge).sort()).toEqual([
        "connectionId",
        "pageAId",
        "pageBId",
        "similarity",
        "source",
        "strength",
      ]);
    }
    const edgeIds = new Set(body.edges.map((edge) => edge.connectionId));
    for (const excluded of [staleEdge, archivedEdge, deletedEdge, otherEdge]) {
      expect(edgeIds.has(excluded)).toBe(false);
    }
    const strong = body.edges.find((edge) => edge.connectionId === liveStrong);
    const [strongPageA, strongPageB] = canonical({ a: alpha, b: beta });
    expect(strong).toEqual({
      connectionId: liveStrong,
      pageAId: strongPageA,
      pageBId: strongPageB,
      similarity: 0.91,
      strength: "strong",
      source: "auto",
    });
  });

  test("connections list is deterministic, ordered and paginates", async () => {
    const seeded = [
      { id: staleEdge, link: { a: alpha, b: stalePage, similarity: 0.99 } },
      { id: liveStrong, link: { a: alpha, b: beta, similarity: 0.91 } },
      { id: archivedEdge, link: { a: beta, b: archivedPage, similarity: 0.88 } },
      { id: deletedEdge, link: { a: gamma, b: deletedPage, similarity: 0.77 } },
      { id: liveMedium, link: { a: beta, b: gamma, similarity: 0.72 } },
      { id: tieA, link: { a: alpha, b: delta, similarity: 0.72 } },
      { id: liveWeak, link: { a: alpha, b: gamma, similarity: 0.42 } },
    ].sort((left, right) => {
      if (right.link.similarity !== left.link.similarity) {
        return right.link.similarity - left.link.similarity;
      }
      const [a1, b1] = canonical(left.link);
      const [a2, b2] = canonical(right.link);
      if (a1 !== a2) return a1 < a2 ? -1 : 1;
      if (b1 !== b2) return b1 < b2 ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    const expectedIds = seeded.map((entry) => entry.id);

    const response = await request(`/v1/brains/${graphBrain}/connections`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<ConnectionBody>;
    matchesContract(response, body, "/v1/brains/{brainId}/connections", "get");
    expect(body.items.map((item) => item.id)).toEqual(expectedIds);
    expect(body.total).toBe(7);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.items.some((item) => item.id === otherEdge)).toBe(false);

    const first = body.items[0];
    expect(first?.id).toMatch(/^cnn_[0-9a-f]{32}$/);
    expect(first?.brainId).toBe(graphBrain);
    expect(first?.similarity).toBe(0.99);
    expect(first?.strength).toBe("strong");
    expect(first?.reasoning).toBe("seed-0.99");
    expect(first?.source).toBe("auto");
    expect(first?.ackedAt).toBeNull();
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "ackedAt",
      "brainId",
      "id",
      "pageAId",
      "pageBId",
      "reasoning",
      "similarity",
      "source",
      "strength",
    ]);

    const medium = body.items.find((item) => item.id === liveMedium);
    expect(medium?.source).toBe("manual");
    expect(medium?.strength).toBe("medium");
    expect(medium?.reasoning).toBe("Beta and gamma overlap");

    const replay = await request(`/v1/brains/${graphBrain}/connections`);
    expect(
      ((await replay.json()) as ListBody<ConnectionBody>).items.map((item) => item.id),
    ).toEqual(expectedIds);

    const paged = await request(`/v1/brains/${graphBrain}/connections?limit=2&offset=1`);
    expect(paged.status).toBe(200);
    const pagedBody = (await paged.json()) as ListBody<ConnectionBody>;
    matchesContract(paged, pagedBody, "/v1/brains/{brainId}/connections", "get");
    expect(pagedBody.items.map((item) => item.id)).toEqual(expectedIds.slice(1, 3));
    expect(pagedBody.total).toBe(7);
    expect(pagedBody.limit).toBe(2);
    expect(pagedBody.offset).toBe(1);
  });

  test("ack is idempotent, clears on false and 404s on a foreign connection", async () => {
    const first = await request(`/v1/brains/${graphBrain}/connections/${liveStrong}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ConnectionBody;
    matchesContract(first, firstBody, "/v1/brains/{brainId}/connections/{connectionId}", "patch");
    expect(firstBody.ackedAt).not.toBeNull();
    expect(firstBody.id).toBe(liveStrong);
    const stamp = firstBody.ackedAt;

    const repeated = await request(`/v1/brains/${graphBrain}/connections/${liveStrong}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(repeated.status).toBe(200);
    const repeatedBody = (await repeated.json()) as ConnectionBody;
    matchesContract(
      repeated,
      repeatedBody,
      "/v1/brains/{brainId}/connections/{connectionId}",
      "patch",
    );
    expect(repeatedBody.ackedAt).toBe(stamp);

    const cleared = await request(`/v1/brains/${graphBrain}/connections/${liveStrong}`, {
      method: "PATCH",
      body: { acked: false },
    });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as ConnectionBody;
    matchesContract(
      cleared,
      clearedBody,
      "/v1/brains/{brainId}/connections/{connectionId}",
      "patch",
    );
    expect(clearedBody.ackedAt).toBeNull();

    const clearedAgain = await request(`/v1/brains/${graphBrain}/connections/${liveStrong}`, {
      method: "PATCH",
      body: { acked: false },
    });
    expect(clearedAgain.status).toBe(200);
    expect(((await clearedAgain.json()) as ConnectionBody).ackedAt).toBeNull();

    const listed = await request(`/v1/brains/${graphBrain}/connections`);
    const listedBody = (await listed.json()) as ListBody<ConnectionBody>;
    expect(listedBody.items.find((item) => item.id === liveStrong)?.ackedAt).toBeNull();

    const foreign = await request(`/v1/brains/${graphBrain}/connections/${otherEdge}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(foreign.status).toBe(404);
    matchesContract(
      foreign,
      await foreign.json(),
      "/v1/brains/{brainId}/connections/{connectionId}",
      "patch",
    );
    const untouched = await owner.query<{ acked_at: Date | null }>(
      "SELECT acked_at FROM connections WHERE id = $1",
      [otherEdge],
    );
    expect(untouched.rows[0]?.acked_at).toBeNull();

    const hidden = await request(`/v1/brains/${graphBrain}/connections/${otherEdge}`, {
      subject: subjectB,
      method: "PATCH",
      body: { acked: true },
    });
    expect(hidden.status).toBe(404);

    const missing = await request(`/v1/brains/${graphBrain}/connections/${newId("connection")}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(missing.status).toBe(404);

    const invalid = await request(`/v1/brains/${graphBrain}/connections/${liveStrong}`, {
      method: "PATCH",
      body: {},
    });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("x-request-id")).toBeTruthy();
  });

  test("a foreign brain is 404 on graph, connections and ack", async () => {
    for (const [path, contractPath] of [
      [`/v1/brains/${foreignBrain}/graph`, "/v1/brains/{brainId}/graph"],
      [`/v1/brains/${foreignBrain}/connections`, "/v1/brains/{brainId}/connections"],
      [`/v1/brains/${otherSubjectBrain}/graph`, "/v1/brains/{brainId}/graph"],
      [`/v1/brains/${otherSubjectBrain}/connections`, "/v1/brains/{brainId}/connections"],
    ] as const) {
      const response = await request(path);
      expect(response.status).toBe(404);
      matchesContract(response, await response.json(), contractPath, "get");
    }

    const foreignAck = await request(`/v1/brains/${foreignBrain}/connections/${otherEdge}`, {
      key: keys.get("foreign") ?? "",
      method: "PATCH",
      body: { acked: true },
    });
    expect(foreignAck.status).toBe(404);

    const crossSubjectAck = await request(
      `/v1/brains/${otherSubjectBrain}/connections/${otherEdge}`,
      { method: "PATCH", body: { acked: true } },
    );
    expect(crossSubjectAck.status).toBe(404);

    const stillNull = await owner.query<{ acked_at: Date | null }>(
      "SELECT acked_at FROM connections WHERE id = $1",
      [otherEdge],
    );
    expect(stillNull.rows[0]?.acked_at).toBeNull();
  });

  test("connection parameters reject out-of-range values", async () => {
    for (const path of [
      `/v1/brains/${graphBrain}/connections?limit=0`,
      `/v1/brains/${graphBrain}/connections?limit=201`,
      `/v1/brains/${graphBrain}/connections?offset=-1`,
    ]) {
      const response = await request(path);
      expect(response.status).toBe(400);
      expect(response.headers.get("x-request-id")).toBeTruthy();
    }
  });
});
