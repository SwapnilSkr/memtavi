import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createFakeProvider } from "@memtavi/llm/fake";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface PageBody {
  id: string;
  subjectId: string;
  brainId: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  pageType: string;
  bucket: string;
  bucketSource: string;
  status: string;
  pinned: boolean;
  archived: boolean;
  version: number;
  entities: string[];
  backlinks: string[];
  contentHash: string;
  embeddingModel: string | null;
  lastCompiledAt: string | null;
  lastReferencedAt: string | null;
  userEditedAt: string | null;
  deletionState: string;
}

interface IndexEntryBody {
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  pinned: boolean;
  updatedAt: string;
}

interface SearchHitBody {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  similarity: number | null;
  updatedAt: string;
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
  summary?: string;
  body?: string;
  pinned?: boolean;
  lastCompiledAt?: string | null;
  lastReferencedAt?: string | null;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");
const embeddingModel = "fake-embedding";
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

describe.skipIf(!ownerUrl || !appUrl)("pages, index and search over the wire", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `read-${crypto.randomUUID()}`;
  const slugB = `read-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const keys = new Map<string, string>();
  const pageIds = new Map<string, string>();
  const embedder = createFakeProvider({ embeddingModel });
  let tenantA: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let semanticApp: ReturnType<typeof createApp>;
  let listBrain: string;
  let indexBrain: string;
  let keywordBrain: string;
  let hybridBrain: string;
  let filterBrain: string;
  let otherSubjectBrain: string;
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  function request(
    path: string,
    options: {
      key?: string;
      subject?: string | null;
      method?: string;
      body?: unknown;
      target?: ReturnType<typeof createApp>;
    } = {},
  ) {
    const headers = new Headers();
    headers.set("x-api-key", options.key ?? keys.get("owner") ?? "");
    if (options.subject !== null) headers.set("x-subject-id", options.subject ?? subjectA);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    return (options.target ?? app).handle(
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

  async function seedPage(brainId: string, page: SeedPage): Promise<string> {
    const id = newId("page");
    await owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type,
          content_hash, pinned, last_compiled_at, last_referenced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'topic', $9, $10, $11, $12)`,
      [
        id,
        tenantA,
        subjectA,
        brainId,
        page.slug,
        page.title ?? page.slug,
        page.summary ?? "",
        page.body ?? "",
        `hash-${page.slug}`,
        page.pinned ?? false,
        page.lastCompiledAt ?? null,
        page.lastReferencedAt ?? null,
      ],
    );
    pageIds.set(page.slug, id);
    return id;
  }

  async function seedEmbedding(pageId: string, vector: readonly number[]): Promise<void> {
    await owner.query(
      `INSERT INTO page_embeddings
         (tenant_id, page_id, model, dimensions, embedding, content_hash)
       VALUES ($1, $2, $3, 1536, $4::vector, $5)`,
      [tenantA, pageId, embeddingModel, `[${vector.join(",")}]`, `embedding-${pageId}`],
    );
  }

  async function vectorFor(text: string): Promise<number[]> {
    const result = await embedder.embed([text]);
    const vector = result.vectors[0];
    if (!vector) throw new Error("fake provider returned no vector");
    return vector;
  }

  async function stampOf(pageId: string): Promise<string> {
    const result = await owner.query<{ stamp: string }>(
      "SELECT last_referenced_at::text AS stamp FROM pages WHERE id = $1",
      [pageId],
    );
    return result.rows[0]?.stamp ?? "";
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Read-path fixtures require a disposable memtavi_test database");
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
    semanticApp = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => fixedNow,
      embeddings: embedder,
    });
    keys.set("owner", await bootstrap(owner, "Read A", slugA));
    keys.set("foreign", await bootstrap(owner, "Read B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";

    listBrain = await createBrain(keys.get("owner") ?? "", subjectA, "list");
    indexBrain = await createBrain(keys.get("owner") ?? "", subjectA, "index");
    keywordBrain = await createBrain(keys.get("owner") ?? "", subjectA, "keyword");
    hybridBrain = await createBrain(keys.get("owner") ?? "", subjectA, "hybrid");
    filterBrain = await createBrain(keys.get("owner") ?? "", subjectA, "filter");
    otherSubjectBrain = await createBrain(keys.get("owner") ?? "", subjectB, "other-subject");

    await seedPage(listBrain, {
      slug: "pinned",
      title: "Pinned",
      pinned: true,
      lastCompiledAt: "2026-01-05T00:00:00.000Z",
      lastReferencedAt: "2026-01-06T00:00:00.000Z",
    });
    await seedPage(listBrain, {
      slug: "newest",
      title: "Newest",
      lastCompiledAt: "2026-03-01T00:00:00.000Z",
      lastReferencedAt: "2026-03-02T00:00:00.000Z",
    });
    await seedPage(listBrain, {
      slug: "middle",
      title: "Middle",
      lastCompiledAt: null,
      lastReferencedAt: "2026-02-01T00:00:00.000Z",
    });
    await seedPage(listBrain, {
      slug: "oldest",
      title: "Oldest",
      lastCompiledAt: "2025-12-01T00:00:00.000Z",
      lastReferencedAt: null,
    });
    await seedPage(listBrain, { slug: "stamp-less", title: "Stamp less" });

    await seedPage(indexBrain, {
      slug: "index-pinned",
      pinned: true,
      lastCompiledAt: "2025-01-01T00:00:00.000Z",
    });
    await seedPage(indexBrain, { slug: "index-compiled", lastCompiledAt: "2026-05-01T00:00:00Z" });
    await seedPage(indexBrain, {
      slug: "index-referenced",
      lastCompiledAt: null,
      lastReferencedAt: "2026-04-01T00:00:00Z",
    });
    await seedPage(indexBrain, { slug: "index-stamp-less" });

    await seedPage(keywordBrain, { slug: "alpha-title", title: "Alpha guide" });
    await seedPage(keywordBrain, {
      slug: "alpha-body",
      title: "Plain note",
      body: "alpha alpha alpha",
    });
    await seedPage(keywordBrain, { slug: "unrelated", title: "Nothing here" });

    const queryVector = await vectorFor("alpha");
    const oppositeVector = queryVector.map((value) => -value);
    await seedPage(hybridBrain, { slug: "both", title: "alpha both" });
    await seedPage(hybridBrain, { slug: "keyword-only", title: "alpha keyword" });
    await seedPage(hybridBrain, { slug: "semantic-only", body: "nothing relevant" });
    await seedPage(hybridBrain, { slug: "below", body: "nothing either" });
    await seedEmbedding(pageIds.get("both") ?? "", queryVector);
    await seedEmbedding(pageIds.get("semantic-only") ?? "", queryVector);
    await seedEmbedding(pageIds.get("below") ?? "", oppositeVector);

    const omegaVector = await vectorFor("omega");
    const negativeOmega = omegaVector.map((value) => -value);
    await seedPage(filterBrain, { slug: "keeper", body: "unrelated keeper" });
    await seedPage(filterBrain, { slug: "dropped", body: "unrelated dropped" });
    await seedPage(filterBrain, { slug: "bypass", title: "omega bypass" });
    await seedEmbedding(pageIds.get("keeper") ?? "", omegaVector);
    await seedEmbedding(pageIds.get("dropped") ?? "", negativeOmega);
    await seedEmbedding(pageIds.get("bypass") ?? "", negativeOmega);
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

  test("list returns full pages, newest first but pinned above every date", async () => {
    const response = await request(`/v1/brains/${listBrain}/pages`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<PageBody>;
    matchesContract(response, body, "/v1/brains/{brainId}/pages", "get");
    expect(body.items.map((item) => item.slug)).toEqual([
      "pinned",
      "newest",
      "middle",
      "oldest",
      "stamp-less",
    ]);
    expect(body.total).toBe(5);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    const newest = body.items.find((item) => item.slug === "newest");
    expect(newest?.id).toMatch(/^pg_[0-9a-f]{32}$/);
    expect(newest?.subjectId).toBe(subjectA);
    expect(newest?.brainId).toBe(listBrain);
    expect(newest?.body).toBe("");
    expect(newest?.pageType).toBe("topic");
    expect(newest?.bucket).toBe("inbox");
    expect(newest?.bucketSource).toBe("auto");
    expect(newest?.status).toBe("active");
    expect(newest?.archived).toBe(false);
    expect(newest?.version).toBe(1);
    expect(newest?.entities).toEqual([]);
    expect(newest?.backlinks).toEqual([]);
    expect(newest?.contentHash).toBe("hash-newest");
    expect(newest?.embeddingModel).toBeNull();
    expect(newest?.lastCompiledAt).toBe("2026-03-01T00:00:00.000Z");
    expect(newest?.lastReferencedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(newest?.userEditedAt).toBeNull();
    expect(newest?.deletionState).toBe("active");
    const paged = await request(`/v1/brains/${listBrain}/pages?limit=2&offset=2`);
    const pagedBody = (await paged.json()) as ListBody<PageBody>;
    matchesContract(paged, pagedBody, "/v1/brains/{brainId}/pages", "get");
    expect(pagedBody.items.map((item) => item.slug)).toEqual(["middle", "oldest"]);
    expect(pagedBody.limit).toBe(2);
    expect(pagedBody.offset).toBe(2);
  });

  test("list does not touch lastReferencedAt", async () => {
    const newestId = pageIds.get("newest") ?? "";
    const middleId = pageIds.get("middle") ?? "";
    const before = [await stampOf(newestId), await stampOf(middleId)];
    const response = await request(`/v1/brains/${listBrain}/pages?limit=200`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<PageBody>;
    expect(body.items.find((item) => item.slug === "newest")?.lastReferencedAt).toBe(
      "2026-03-02T00:00:00.000Z",
    );
    expect([await stampOf(newestId), await stampOf(middleId)]).toEqual(before);
  });

  test("get bumps lastReferencedAt in the read transaction", async () => {
    const oldestId = pageIds.get("oldest") ?? "";
    const response = await request(`/v1/brains/${listBrain}/pages/oldest`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody;
    matchesContract(response, body, "/v1/brains/{brainId}/pages/{slug}", "get");
    expect(body.slug).toBe("oldest");
    expect(body.lastReferencedAt).not.toBeNull();
    const returned = new Date(body.lastReferencedAt ?? "").getTime();
    expect(returned).toBeGreaterThan(new Date("2025-12-01T00:00:00.000Z").getTime());
    const stored = await owner.query<{ stamp: Date }>(
      "SELECT last_referenced_at AS stamp FROM pages WHERE id = $1",
      [oldestId],
    );
    expect(stored.rows[0]?.stamp.getTime()).toBe(returned);
    const beforeList = await stampOf(oldestId);
    const listed = await request(`/v1/brains/${listBrain}/pages?limit=200`);
    expect(listed.status).toBe(200);
    expect(await stampOf(oldestId)).toBe(beforeList);
  });

  test("index returns compact entries ordered pinned then updated", async () => {
    const response = await request(`/v1/brains/${indexBrain}/index`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<IndexEntryBody>;
    matchesContract(response, body, "/v1/brains/{brainId}/index", "get");
    expect(body.items.map((item) => item.slug)).toEqual([
      "index-pinned",
      "index-compiled",
      "index-referenced",
      "index-stamp-less",
    ]);
    expect(body.total).toBe(4);
    expect(body.limit).toBe(40);
    expect(body.offset).toBe(0);
    expect(body.items.every((item) => !("body" in item))).toBe(true);
    expect(body.items[0]?.updatedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(body.items[3]?.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    const paged = await request(`/v1/brains/${indexBrain}/index?limit=2`);
    const pagedBody = (await paged.json()) as ListBody<IndexEntryBody>;
    matchesContract(paged, pagedBody, "/v1/brains/{brainId}/index", "get");
    expect(pagedBody.items).toHaveLength(2);
    expect(pagedBody.limit).toBe(2);
  });

  test("keyword search returns hits whose similarity is null and bumps nothing", async () => {
    const newestId = pageIds.get("alpha-title") ?? "";
    const before = await stampOf(newestId);
    const response = await request(`/v1/brains/${keywordBrain}/search?q=alpha`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<SearchHitBody>;
    matchesContract(response, body, "/v1/brains/{brainId}/search", "get");
    expect(body.items.map((item) => item.slug).sort()).toEqual(["alpha-body", "alpha-title"]);
    expect(body.items.every((item) => item.similarity === null)).toBe(true);
    expect(body.items.every((item) => typeof item.updatedAt === "string")).toBe(true);
    expect(body.items.every((item) => item.pageType === "topic")).toBe(true);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(await stampOf(newestId)).toBe(before);
    const repeated = await request(`/v1/brains/${keywordBrain}/search?q=alpha`);
    const repeatedBody = (await repeated.json()) as ListBody<SearchHitBody>;
    expect(repeatedBody.items.map((item) => item.slug)).toEqual(
      body.items.map((item) => item.slug),
    );
  });

  test("hybrid search fuses both lists with a deterministic RRF order", async () => {
    const response = await request(`/v1/brains/${hybridBrain}/search?q=alpha`, {
      target: semanticApp,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<SearchHitBody>;
    matchesContract(response, body, "/v1/brains/{brainId}/search", "get");
    expect(body.items.map((item) => item.slug)).toEqual([
      "both",
      "keyword-only",
      "semantic-only",
      "below",
    ]);
    const both = body.items[0];
    expect(both?.similarity).not.toBeNull();
    expect(Math.abs((both?.similarity ?? 0) - 1)).toBeLessThan(1e-6);
    expect(body.items.find((item) => item.slug === "keyword-only")?.similarity).toBeNull();
    expect(
      Math.abs((body.items.find((item) => item.slug === "semantic-only")?.similarity ?? 0) - 1),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs((body.items.find((item) => item.slug === "below")?.similarity ?? 0) + 1),
    ).toBeLessThan(1e-6);
    const repeated = await request(`/v1/brains/${hybridBrain}/search?q=alpha`, {
      target: semanticApp,
    });
    const repeatedBody = (await repeated.json()) as ListBody<SearchHitBody>;
    expect(repeatedBody.items).toEqual(body.items);
  });

  test("minSimilarity drops semantic-only hits but not keyword matches", async () => {
    const unfiltered = await request(`/v1/brains/${filterBrain}/search?q=omega`, {
      target: semanticApp,
    });
    expect(unfiltered.status).toBe(200);
    const unfilteredBody = (await unfiltered.json()) as ListBody<SearchHitBody>;
    matchesContract(unfiltered, unfilteredBody, "/v1/brains/{brainId}/search", "get");
    expect(unfilteredBody.items.map((item) => item.slug).sort()).toEqual([
      "bypass",
      "dropped",
      "keeper",
    ]);
    const filtered = await request(`/v1/brains/${filterBrain}/search?q=omega&minSimilarity=0.5`, {
      target: semanticApp,
    });
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as ListBody<SearchHitBody>;
    matchesContract(filtered, filteredBody, "/v1/brains/{brainId}/search", "get");
    expect(filteredBody.items.map((item) => item.slug).sort()).toEqual(["bypass", "keeper"]);
    const keeper = filteredBody.items.find((item) => item.slug === "keeper");
    expect((keeper?.similarity ?? 0) >= 0.5).toBe(true);
    const bypass = filteredBody.items.find((item) => item.slug === "bypass");
    expect(bypass?.similarity).not.toBeNull();
    expect((bypass?.similarity ?? 0) < 0.5).toBe(true);
  });

  test.each([
    ["list", "/v1/brains/{brainId}/pages", "pages"],
    ["get", "/v1/brains/{brainId}/pages/{slug}", "pages/alpha-title"],
    ["index", "/v1/brains/{brainId}/index", "index"],
    ["search", "/v1/brains/{brainId}/search", "search?q=alpha"],
  ])("a foreign brain is a 404 on %s", async (_label, contractPath, suffix) => {
    const foreign = await request(`/v1/brains/${keywordBrain}/${suffix}`, {
      key: keys.get("foreign") ?? "",
    });
    expect(foreign.status).toBe(404);
    matchesContract(foreign, await foreign.json(), contractPath, "get");
    const otherSubject = await request(`/v1/brains/${keywordBrain}/${suffix}`, {
      subject: subjectB,
    });
    expect(otherSubject.status).toBe(404);
    matchesContract(otherSubject, await otherSubject.json(), contractPath, "get");
  });

  test("unknown brains and slugs are 404 and an empty brain lists zero", async () => {
    const missingBrain = `brn_${"0".repeat(32)}`;
    for (const [contractPath, suffix] of [
      ["/v1/brains/{brainId}/pages", "pages"],
      ["/v1/brains/{brainId}/pages/{slug}", "pages/missing"],
      ["/v1/brains/{brainId}/index", "index"],
      ["/v1/brains/{brainId}/search", "search?q=alpha"],
    ] as const) {
      const response = await request(`/v1/brains/${missingBrain}/${suffix}`);
      expect(response.status).toBe(404);
      matchesContract(response, await response.json(), contractPath, "get");
    }
    const missingSlug = await request(`/v1/brains/${keywordBrain}/pages/not-a-page`);
    expect(missingSlug.status).toBe(404);
    matchesContract(
      missingSlug,
      await missingSlug.json(),
      "/v1/brains/{brainId}/pages/{slug}",
      "get",
    );
    const hidden = await request(`/v1/brains/${otherSubjectBrain}/pages`);
    expect(hidden.status).toBe(404);
    const empty = await createBrain(keys.get("owner") ?? "", subjectA, "empty");
    const listed = await request(`/v1/brains/${empty}/pages`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as ListBody<PageBody>;
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  test("search rejects a missing phrase and out-of-range parameters", async () => {
    for (const path of [
      `/v1/brains/${keywordBrain}/search`,
      `/v1/brains/${keywordBrain}/search?q=`,
      `/v1/brains/${keywordBrain}/search?q=alpha&limit=0`,
      `/v1/brains/${keywordBrain}/search?q=alpha&limit=201`,
      `/v1/brains/${keywordBrain}/search?q=alpha&minSimilarity=-0.1`,
      `/v1/brains/${keywordBrain}/search?q=alpha&minSimilarity=1.1`,
      `/v1/brains/${indexBrain}/index?limit=0`,
      `/v1/brains/${indexBrain}/index?limit=201`,
    ]) {
      const response = await request(path);
      expect(response.status).toBe(400);
      expect(response.headers.get("x-request-id")).toBeTruthy();
    }
  });
});
