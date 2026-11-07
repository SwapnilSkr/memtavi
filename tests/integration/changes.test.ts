import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createFakeProvider, type FakeEmbeddingCall } from "@memtavi/llm/fake";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { contentHash } from "@memtavi/storage/keys";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import { parse } from "yaml";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

interface ChangeEventBody {
  id: string;
  brainId: string;
  pageId: string;
  action: string;
  changeSummary: string;
  fromVersion: number | null;
  toVersion: number;
  ingestSourceId: string | null;
  contradictions: unknown[];
  ackedAt: string | null;
  createdAt: string;
}

interface PageBody {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: string;
  version: number;
  contentHash: string;
  embeddingModel: string | null;
  userEditedAt: string | null;
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
  status?: string;
  version?: number;
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

function unitVector(): number[] {
  return Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
}

describe.skipIf(!ownerUrl || !appUrl)("change feed, acknowledgements and page edits", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const suffix = crypto.randomUUID().slice(0, 8);
  const slugA = `changes-a-${suffix}`;
  const slugB = `changes-b-${suffix}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const subjectC = crypto.randomUUID();
  const keys = new Map<string, string>();
  const embedder = createFakeProvider({ embeddingModel });
  let tenantA: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let semanticApp: ReturnType<typeof createApp>;
  let changesBrain: string;
  let pagesBrain: string;
  let otherSubjectBrain: string;
  let foreignBrain: string;
  let feedPage: string;
  let partialPage: string;
  let stalePage: string;
  let contestedPage: string;
  let embeddedPage: string;
  let staleEmbeddedPage: string;
  let eventOld: string;
  let eventMid: string;
  let eventNew: string;
  let otherSubjectEvent: string;
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

  async function seedPage(
    brainId: string,
    page: SeedPage,
    subject: string = subjectA,
  ): Promise<string> {
    const id = newId("page");
    await owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, status, version, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        tenantA,
        subject,
        brainId,
        page.slug,
        page.title ?? page.slug,
        page.summary ?? "",
        page.body ?? "",
        page.status ?? "active",
        page.version ?? 1,
        `seed-${page.slug}`,
      ],
    );
    return id;
  }

  async function seedVersion(
    pageId: string,
    version: number,
    page: { title: string; summary: string; body: string },
    actor: "compiler" | "user" = "compiler",
  ): Promise<void> {
    await owner.query(
      `INSERT INTO page_versions
         (tenant_id, page_id, version, title, summary, body, ingest_source_id, actor)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [tenantA, pageId, version, page.title, page.summary, page.body, actor],
    );
  }

  async function seedChange(
    brainId: string,
    pageId: string,
    change: { createdAt: string; action?: string; summary?: string; toVersion?: number },
  ): Promise<string> {
    const id = newId("change");
    await owner.query(
      `INSERT INTO change_events
         (id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
      [
        id,
        tenantA,
        brainId,
        pageId,
        change.action ?? "created",
        change.summary ?? "Seeded change",
        change.toVersion ?? 1,
        change.createdAt,
      ],
    );
    return id;
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Change fixtures require a disposable memtavi_test database");
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
    keys.set("owner", await bootstrap(owner, "Changes A", slugA));
    keys.set("foreign", await bootstrap(owner, "Changes B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";

    changesBrain = await createBrain(keys.get("owner") ?? "", subjectA, "feed");
    pagesBrain = await createBrain(keys.get("owner") ?? "", subjectA, "edits");
    otherSubjectBrain = await createBrain(keys.get("owner") ?? "", subjectB, "other");
    foreignBrain = await createBrain(keys.get("foreign") ?? "", subjectC, "foreign");

    feedPage = await seedPage(changesBrain, { slug: "feed-page", title: "Feed page" });
    const otherPage = await seedPage(
      otherSubjectBrain,
      { slug: "other-page", title: "Other page" },
      subjectB,
    );
    eventMid = await seedChange(changesBrain, feedPage, {
      createdAt: "2026-01-02T00:00:00.000Z",
      summary: "Middle change",
    });
    eventOld = await seedChange(changesBrain, feedPage, {
      createdAt: "2026-01-01T00:00:00.000Z",
      summary: "Oldest change",
    });
    eventNew = await seedChange(changesBrain, feedPage, {
      createdAt: "2026-01-03T00:00:00.000Z",
      summary: "Newest change",
    });
    otherSubjectEvent = await seedChange(otherSubjectBrain, otherPage, {
      createdAt: "2026-01-04T00:00:00.000Z",
      summary: "Hidden change",
    });

    partialPage = await seedPage(pagesBrain, {
      slug: "partial",
      title: "Original title",
      summary: "Original summary",
      body: "Original body",
    });
    await seedVersion(partialPage, 1, {
      title: "Original title",
      summary: "Original summary",
      body: "Original body",
    });

    stalePage = await seedPage(pagesBrain, {
      slug: "stale",
      title: "Stale title",
      summary: "Stale summary",
      body: "Stale body",
      version: 2,
    });
    await seedVersion(stalePage, 1, {
      title: "Stale title",
      summary: "Stale summary",
      body: "Stale body",
    });
    await seedVersion(stalePage, 2, {
      title: "Stale title",
      summary: "Stale summary",
      body: "Stale body",
    });

    contestedPage = await seedPage(pagesBrain, {
      slug: "contested",
      title: "Contested title",
      summary: "Contested summary",
      body: "Contested body",
      status: "contested",
      version: 3,
    });
    await seedVersion(contestedPage, 3, {
      title: "Contested title",
      summary: "Contested summary",
      body: "Contested body",
    });

    embeddedPage = await seedPage(pagesBrain, {
      slug: "embedded",
      title: "Embed title",
      summary: "Embed summary",
      body: "Embed body",
    });

    staleEmbeddedPage = await seedPage(pagesBrain, {
      slug: "stale-embedded",
      title: "Stale embed",
      summary: "Stale summary",
      body: "Stale body",
    });
    await owner.query(
      `INSERT INTO page_embeddings
         (tenant_id, page_id, model, dimensions, embedding, content_hash)
       VALUES ($1, $2, 'seed-model', 1536, $3::vector, $4)`,
      [
        tenantA,
        staleEmbeddedPage,
        JSON.stringify(unitVector()),
        contentHash("Stale embed\nStale summary\nStale body"),
      ],
    );
    await owner.query("UPDATE pages SET embedding_model = 'seed-model' WHERE id = $1", [
      staleEmbeddedPage,
    ]);
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

  test("the change feed is newest first, paginates and hides foreign brains", async () => {
    const foreign = await request(`/v1/brains/${changesBrain}/changes`, {
      key: keys.get("foreign") ?? "",
    });
    expect(foreign.status).toBe(404);
    matchesContract(foreign, await foreign.json(), "/v1/brains/{brainId}/changes", "get");
    const otherSubject = await request(`/v1/brains/${changesBrain}/changes`, { subject: subjectB });
    expect(otherSubject.status).toBe(404);
    matchesContract(otherSubject, await otherSubject.json(), "/v1/brains/{brainId}/changes", "get");

    const response = await request(`/v1/brains/${changesBrain}/changes`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<ChangeEventBody>;
    matchesContract(response, body, "/v1/brains/{brainId}/changes", "get");
    expect(body.items.map((item) => item.id)).toEqual([eventNew, eventMid, eventOld]);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    const newest = body.items[0];
    expect(newest?.id).toMatch(/^chg_[0-9a-f]{32}$/);
    expect(newest?.brainId).toBe(changesBrain);
    expect(newest?.pageId).toBe(feedPage);
    expect(newest?.action).toBe("created");
    expect(newest?.changeSummary).toBe("Newest change");
    expect(newest?.fromVersion).toBeNull();
    expect(newest?.toVersion).toBe(1);
    expect(newest?.ingestSourceId).toBeNull();
    expect(newest?.contradictions).toEqual([]);
    expect(newest?.ackedAt).toBeNull();
    expect(newest?.createdAt).toBe("2026-01-03T00:00:00.000Z");

    const paged = await request(`/v1/brains/${changesBrain}/changes?limit=2&offset=1`);
    expect(paged.status).toBe(200);
    const pagedBody = (await paged.json()) as ListBody<ChangeEventBody>;
    matchesContract(paged, pagedBody, "/v1/brains/{brainId}/changes", "get");
    expect(pagedBody.items.map((item) => item.id)).toEqual([eventMid, eventOld]);
    expect(pagedBody.total).toBe(3);
    expect(pagedBody.limit).toBe(2);
    expect(pagedBody.offset).toBe(1);
  });

  test("ack is idempotent, clears on false and 404s on a foreign change", async () => {
    const first = await request(`/v1/brains/${changesBrain}/changes/${eventNew}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ChangeEventBody;
    matchesContract(first, firstBody, "/v1/brains/{brainId}/changes/{changeId}", "patch");
    expect(firstBody.ackedAt).not.toBeNull();
    const stamp = firstBody.ackedAt;

    const repeated = await request(`/v1/brains/${changesBrain}/changes/${eventNew}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(repeated.status).toBe(200);
    const repeatedBody = (await repeated.json()) as ChangeEventBody;
    matchesContract(repeated, repeatedBody, "/v1/brains/{brainId}/changes/{changeId}", "patch");
    expect(repeatedBody.ackedAt).toBe(stamp);

    const cleared = await request(`/v1/brains/${changesBrain}/changes/${eventNew}`, {
      method: "PATCH",
      body: { acked: false },
    });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as ChangeEventBody;
    matchesContract(cleared, clearedBody, "/v1/brains/{brainId}/changes/{changeId}", "patch");
    expect(clearedBody.ackedAt).toBeNull();

    const foreign = await request(`/v1/brains/${changesBrain}/changes/${eventNew}`, {
      key: keys.get("foreign") ?? "",
      method: "PATCH",
      body: { acked: true },
    });
    expect(foreign.status).toBe(404);
    matchesContract(
      foreign,
      await foreign.json(),
      "/v1/brains/{brainId}/changes/{changeId}",
      "patch",
    );

    const hidden = await request(`/v1/brains/${changesBrain}/changes/${otherSubjectEvent}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(hidden.status).toBe(404);
    matchesContract(
      hidden,
      await hidden.json(),
      "/v1/brains/{brainId}/changes/{changeId}",
      "patch",
    );
    const untouched = await owner.query<{ acked_at: Date | null }>(
      "SELECT acked_at FROM change_events WHERE id = $1",
      [otherSubjectEvent],
    );
    expect(untouched.rows[0]?.acked_at).toBeNull();

    const missing = await request(`/v1/brains/${changesBrain}/changes/${newId("change")}`, {
      method: "PATCH",
      body: { acked: true },
    });
    expect(missing.status).toBe(404);
    matchesContract(
      missing,
      await missing.json(),
      "/v1/brains/{brainId}/changes/{changeId}",
      "patch",
    );

    const invalid = await request(`/v1/brains/${changesBrain}/changes/${eventNew}`, {
      method: "PATCH",
      body: {},
    });
    expect(invalid.status).toBe(400);
    matchesContract(
      invalid,
      await invalid.json(),
      "/v1/brains/{brainId}/changes/{changeId}",
      "patch",
    );
  });

  test("a partial edit bumps the version and records the user version and change", async () => {
    const response = await request(`/v1/brains/${pagesBrain}/pages/partial`, {
      method: "PATCH",
      body: { title: "Edited title", body: "Edited body", version: 1 },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    matchesContract(response, page, "/v1/brains/{brainId}/pages/{slug}", "patch");
    expect(page.title).toBe("Edited title");
    expect(page.summary).toBe("Original summary");
    expect(page.body).toBe("Edited body");
    expect(page.version).toBe(2);
    expect(page.userEditedAt).not.toBeNull();
    expect(page.contentHash).toBe(contentHash("Edited title\nOriginal summary\nEdited body"));

    const versions = await owner.query<{
      version: number;
      title: string;
      summary: string;
      body: string;
      actor: string;
      ingest_source_id: string | null;
    }>(
      `SELECT version, title, summary, body, actor, ingest_source_id
       FROM page_versions WHERE page_id = $1 AND version = 2`,
      [partialPage],
    );
    expect(versions.rows).toEqual([
      {
        version: 2,
        title: "Edited title",
        summary: "Original summary",
        body: "Edited body",
        actor: "user",
        ingest_source_id: null,
      },
    ]);

    const changes = await owner.query<{
      action: string;
      change_summary: string;
      from_version: number | null;
      to_version: number;
      ingest_source_id: string | null;
    }>(
      `SELECT action, change_summary, from_version, to_version, ingest_source_id
       FROM change_events WHERE page_id = $1 ORDER BY created_at DESC, id`,
      [partialPage],
    );
    expect(changes.rows).toEqual([
      {
        action: "updated",
        change_summary: "Edited by user",
        from_version: 1,
        to_version: 2,
        ingest_source_id: null,
      },
    ]);
  });

  test("a stale version returns 409 and writes nothing", async () => {
    const response = await request(`/v1/brains/${pagesBrain}/pages/stale`, {
      method: "PATCH",
      body: { title: "Nope", version: 1 },
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { message: string; body: { error: string } };
    matchesContract(response, body, "/v1/brains/{brainId}/pages/{slug}", "patch");
    expect(body.message).toBe("Version conflict");
    expect(body.body.error).toBe("ConflictError");

    const stored = await owner.query<{
      title: string;
      version: number;
      user_edited_at: Date | null;
    }>("SELECT title, version, user_edited_at FROM pages WHERE id = $1", [stalePage]);
    expect(stored.rows[0]?.title).toBe("Stale title");
    expect(stored.rows[0]?.version).toBe(2);
    expect(stored.rows[0]?.user_edited_at).toBeNull();

    const versionCount = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM page_versions WHERE page_id = $1",
      [stalePage],
    );
    expect(versionCount.rows[0]?.total).toBe(2);
    const changeCount = await owner.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM change_events WHERE page_id = $1",
      [stalePage],
    );
    expect(changeCount.rows[0]?.total).toBe(0);
  });

  test("resolving a contested page sets it active", async () => {
    const response = await request(`/v1/brains/${pagesBrain}/pages/contested`, {
      method: "PATCH",
      body: { status: "active", version: 3 },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    matchesContract(response, page, "/v1/brains/{brainId}/pages/{slug}", "patch");
    expect(page.status).toBe("active");
    expect(page.version).toBe(4);

    const change = await owner.query<{ action: string; from_version: number; to_version: number }>(
      `SELECT action, from_version, to_version FROM change_events WHERE page_id = $1`,
      [contestedPage],
    );
    expect(change.rows).toEqual([{ action: "updated", from_version: 3, to_version: 4 }]);
  });

  test("an edit re-embeds when a provider is configured", async () => {
    const expectedText = "Embed title\nEmbed summary\nFresh body";
    const expectedHash = contentHash(expectedText);
    const response = await request(`/v1/brains/${pagesBrain}/pages/embedded`, {
      method: "PATCH",
      body: { body: "Fresh body" },
      target: semanticApp,
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    matchesContract(response, page, "/v1/brains/{brainId}/pages/{slug}", "patch");
    expect(page.contentHash).toBe(expectedHash);
    expect(page.embeddingModel).toBe(embeddingModel);

    const stored = await owner.query<{
      model: string;
      dimensions: number;
      content_hash: string;
    }>(`SELECT model, dimensions, content_hash FROM page_embeddings WHERE page_id = $1`, [
      embeddedPage,
    ]);
    expect(stored.rows).toEqual([
      { model: embeddingModel, dimensions: 1536, content_hash: expectedHash },
    ]);
    const embedCalls = embedder.calls.filter(
      (call): call is FakeEmbeddingCall => call.kind === "embed",
    );
    expect(embedCalls.at(-1)?.texts).toEqual([expectedText]);
  });

  test("an edit without a provider succeeds and leaves the embedding stale", async () => {
    const oldHash = contentHash("Stale embed\nStale summary\nStale body");
    const expectedHash = contentHash("Stale embed\nStale summary\nChanged body");
    const response = await request(`/v1/brains/${pagesBrain}/pages/stale-embedded`, {
      method: "PATCH",
      body: { body: "Changed body" },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    matchesContract(response, page, "/v1/brains/{brainId}/pages/{slug}", "patch");
    expect(page.version).toBe(2);
    expect(page.contentHash).toBe(expectedHash);
    expect(page.embeddingModel).toBe("seed-model");

    const stored = await owner.query<{ model: string; content_hash: string }>(
      "SELECT model, content_hash FROM page_embeddings WHERE page_id = $1",
      [staleEmbeddedPage],
    );
    expect(stored.rows).toEqual([{ model: "seed-model", content_hash: oldHash }]);
  });

  test("edits and acks 404 on a foreign brain, a foreign subject and an unknown slug", async () => {
    const foreignEdit = await request(`/v1/brains/${pagesBrain}/pages/embedded`, {
      key: keys.get("foreign") ?? "",
      method: "PATCH",
      body: { body: "Nope" },
    });
    expect(foreignEdit.status).toBe(404);
    matchesContract(
      foreignEdit,
      await foreignEdit.json(),
      "/v1/brains/{brainId}/pages/{slug}",
      "patch",
    );

    const otherSubjectEdit = await request(`/v1/brains/${pagesBrain}/pages/embedded`, {
      subject: subjectB,
      method: "PATCH",
      body: { body: "Nope" },
    });
    expect(otherSubjectEdit.status).toBe(404);
    matchesContract(
      otherSubjectEdit,
      await otherSubjectEdit.json(),
      "/v1/brains/{brainId}/pages/{slug}",
      "patch",
    );

    const missingSlug = await request(`/v1/brains/${pagesBrain}/pages/not-a-page`, {
      method: "PATCH",
      body: { body: "Nope" },
    });
    expect(missingSlug.status).toBe(404);
    matchesContract(
      missingSlug,
      await missingSlug.json(),
      "/v1/brains/{brainId}/pages/{slug}",
      "patch",
    );

    const foreignBrainAck = await request(`/v1/brains/${foreignBrain}/changes/${eventNew}`, {
      key: keys.get("foreign") ?? "",
      method: "PATCH",
      body: { acked: true },
    });
    expect(foreignBrainAck.status).toBe(404);
    matchesContract(
      foreignBrainAck,
      await foreignBrainAck.json(),
      "/v1/brains/{brainId}/changes/{changeId}",
      "patch",
    );
  });

  test("page and change parameters reject out-of-range values", async () => {
    for (const [path, method, body] of [
      [`/v1/brains/${changesBrain}/changes?limit=0`, "GET", undefined],
      [`/v1/brains/${changesBrain}/changes?limit=201`, "GET", undefined],
      [`/v1/brains/${pagesBrain}/pages/parts`, "PATCH", { version: 0 }],
      [`/v1/brains/${pagesBrain}/pages/parts`, "PATCH", { status: "unknown" }],
    ] as const) {
      const response = await request(path, {
        method,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("x-request-id")).toBeTruthy();
    }
  });
});
