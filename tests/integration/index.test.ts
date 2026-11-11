import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { Pool } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";
import { type Contract, createContract } from "../support/contract";

interface IndexEntryBody {
  slug: string;
  title: string;
  summary: string;
  pageType: string;
  pinned: boolean;
  status: string;
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
  status?: string;
  pinned?: boolean;
  lastCompiledAt?: string | null;
  lastReferencedAt?: string | null;
}

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const fixedNow = new Date("2026-11-07T00:00:00.000Z");
const contract: Contract = createContract();

describe.skipIf(!ownerUrl || !appUrl)("the brain index pages and filters", () => {
  const owner = new Pool({ connectionString: ownerUrl });
  const application = new Pool({ connectionString: appUrl });
  const slugA = `index-${crypto.randomUUID()}`;
  const slugB = `index-${crypto.randomUUID()}`;
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const keys = new Map<string, string>();
  let tenantA: string;
  let db: typeof import("@memtavi/db/client");
  let app: ReturnType<typeof createApp>;
  let brain: string;
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

  async function seedPage(brainId: string, subjectId: string, page: SeedPage): Promise<string> {
    const id = newId("page");
    await owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type,
          content_hash, status, pinned, last_compiled_at, last_referenced_at)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', 'topic', $7, $8, $9, $10, $11)`,
      [
        id,
        tenantA,
        subjectId,
        brainId,
        page.slug,
        page.slug,
        `hash-${page.slug}`,
        page.status ?? "active",
        page.pinned ?? false,
        page.lastCompiledAt ?? null,
        page.lastReferencedAt ?? null,
      ],
    );
    return id;
  }

  async function referenceStamp(pageId: string): Promise<string> {
    const result = await owner.query<{ stamp: string }>(
      "SELECT last_referenced_at::text AS stamp FROM pages WHERE id = $1",
      [pageId],
    );
    return result.rows[0]?.stamp ?? "";
  }

  function expectIndex(response: Response, body: unknown): void {
    contract.expectContract(response, body, {
      method: "GET",
      path: "/v1/brains/{brainId}/index",
    });
  }

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Index fixtures require a disposable memtavi_test database");
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
    keys.set("owner", await bootstrap(owner, "Index A", slugA));
    keys.set("foreign", await bootstrap(owner, "Index B", slugB));
    const tenants = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenantA = tenants.rows.find((row) => row.slug === slugA)?.id ?? "";

    brain = await createBrain(keys.get("owner") ?? "", subjectA, "index");
    otherSubjectBrain = await createBrain(keys.get("owner") ?? "", subjectB, "index-other");

    await seedPage(brain, subjectA, {
      slug: "pinned",
      pinned: true,
      lastCompiledAt: "2026-01-01T00:00:00.000Z",
    });
    await seedPage(brain, subjectA, { slug: "one", lastCompiledAt: "2026-05-01T00:00:00.000Z" });
    await seedPage(brain, subjectA, {
      slug: "two",
      status: "contested",
      lastCompiledAt: null,
      lastReferencedAt: "2026-04-01T00:00:00.000Z",
    });
    await seedPage(brain, subjectA, { slug: "three", lastCompiledAt: "2026-03-01T00:00:00.000Z" });
    await seedPage(brain, subjectA, {
      slug: "four",
      status: "stale",
      lastCompiledAt: null,
      lastReferencedAt: null,
    });
    await seedPage(brain, subjectA, { slug: "five", lastCompiledAt: "2026-02-01T00:00:00.000Z" });
    await seedPage(otherSubjectBrain, subjectB, { slug: "elsewhere" });
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

  test("pages by offset with no overlap or gap in a stable order", async () => {
    const first = await request(`/v1/brains/${brain}/index?limit=3&offset=0`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ListBody<IndexEntryBody>;
    expectIndex(first, firstBody);
    expect(firstBody.items.map((item) => item.slug)).toEqual(["pinned", "one", "two"]);
    expect(firstBody.total).toBe(6);
    expect(firstBody.limit).toBe(3);
    expect(firstBody.offset).toBe(0);

    const second = await request(`/v1/brains/${brain}/index?limit=3&offset=3`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ListBody<IndexEntryBody>;
    expectIndex(second, secondBody);
    expect(secondBody.items.map((item) => item.slug)).toEqual(["three", "five", "four"]);
    expect(secondBody.total).toBe(6);
    expect(secondBody.offset).toBe(3);

    const collected = [...firstBody.items, ...secondBody.items].map((item) => item.slug);
    expect(collected).toEqual(["pinned", "one", "two", "three", "five", "four"]);
    expect(new Set(collected).size).toBe(collected.length);

    const whole = await request(`/v1/brains/${brain}/index?limit=200`);
    const wholeBody = (await whole.json()) as ListBody<IndexEntryBody>;
    expectIndex(whole, wholeBody);
    expect(wholeBody.items.map((item) => item.slug)).toEqual(collected);

    const beyond = await request(`/v1/brains/${brain}/index?limit=3&offset=30`);
    expect(beyond.status).toBe(200);
    const beyondBody = (await beyond.json()) as ListBody<IndexEntryBody>;
    expectIndex(beyond, beyondBody);
    expect(beyondBody.items).toEqual([]);
    expect(beyondBody.total).toBe(6);
    expect(beyondBody.offset).toBe(30);
  });

  test("each entry carries its status and stays body-free", async () => {
    const response = await request(`/v1/brains/${brain}/index`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody<IndexEntryBody>;
    expectIndex(response, body);
    expect(body.items.every((item) => typeof item.status === "string")).toBe(true);
    expect(body.items.every((item) => !("body" in item))).toBe(true);
    expect(body.items.find((item) => item.slug === "two")?.status).toBe("contested");
    expect(body.items.find((item) => item.slug === "four")?.status).toBe("stale");
    expect(body.items.find((item) => item.slug === "one")?.status).toBe("active");
    expect(body.items.find((item) => item.slug === "pinned")?.pinned).toBe(true);
    expect(body.items.find((item) => item.slug === "pinned")?.updatedAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("the status filter narrows entries and total", async () => {
    const contested = await request(`/v1/brains/${brain}/index?status=contested`);
    expect(contested.status).toBe(200);
    const contestedBody = (await contested.json()) as ListBody<IndexEntryBody>;
    expectIndex(contested, contestedBody);
    expect(contestedBody.items.map((item) => item.slug)).toEqual(["two"]);
    expect(contestedBody.items.every((item) => item.status === "contested")).toBe(true);
    expect(contestedBody.total).toBe(1);

    const active = await request(`/v1/brains/${brain}/index?status=active&limit=200`);
    expect(active.status).toBe(200);
    const activeBody = (await active.json()) as ListBody<IndexEntryBody>;
    expectIndex(active, activeBody);
    expect(activeBody.items.map((item) => item.slug)).toEqual(["pinned", "one", "three", "five"]);
    expect(activeBody.items.every((item) => item.status === "active")).toBe(true);
    expect(activeBody.total).toBe(4);

    const missing = await request(`/v1/brains/${brain}/index?status=archived`);
    expect(missing.status).toBe(200);
    const missingBody = (await missing.json()) as ListBody<IndexEntryBody>;
    expectIndex(missing, missingBody);
    expect(missingBody.items).toEqual([]);
    expect(missingBody.total).toBe(0);

    const paged = await request(`/v1/brains/${brain}/index?status=active&limit=2&offset=2`);
    expect(paged.status).toBe(200);
    const pagedBody = (await paged.json()) as ListBody<IndexEntryBody>;
    expectIndex(paged, pagedBody);
    expect(pagedBody.items.map((item) => item.slug)).toEqual(["three", "five"]);
    expect(pagedBody.total).toBe(4);
  });

  test("reading the index leaves lastReferencedAt untouched", async () => {
    const pageId = await owner.query<{ id: string }>(
      "SELECT id FROM pages WHERE brain_id = $1 AND slug = 'two'",
      [brain],
    );
    const id = pageId.rows[0]?.id ?? "";
    const before = await referenceStamp(id);
    expect(before).toContain("2026-04-01");

    for (const path of [
      `/v1/brains/${brain}/index`,
      `/v1/brains/${brain}/index?limit=2&offset=1`,
      `/v1/brains/${brain}/index?status=contested`,
    ]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expectIndex(response, await response.json());
    }

    expect(await referenceStamp(id)).toBe(before);
  });

  test("a negative offset, an unknown status and out-of-range limits answer 400", async () => {
    for (const path of [
      `/v1/brains/${brain}/index?offset=-1`,
      `/v1/brains/${brain}/index?status=not-a-status`,
      `/v1/brains/${brain}/index?limit=0`,
      `/v1/brains/${brain}/index?limit=201`,
      `/v1/brains/${brain}/index?limit=1.5`,
    ]) {
      const response = await request(path);
      expect(response.status).toBe(400);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expectIndex(response, await response.json());
    }
  });

  test("a foreign or other-subject brain is a 404 that leaks nothing", async () => {
    const otherSubject = await request(`/v1/brains/${otherSubjectBrain}/index?status=active`);
    expect(otherSubject.status).toBe(404);
    const otherSubjectBody = await otherSubject.json();
    expectIndex(otherSubject, otherSubjectBody);
    expect(JSON.stringify(otherSubjectBody)).not.toContain("elsewhere");

    const foreign = await request(`/v1/brains/${brain}/index?offset=1`, {
      key: keys.get("foreign") ?? "",
    });
    expect(foreign.status).toBe(404);
    const foreignBody = await foreign.json();
    expectIndex(foreign, foreignBody);
    expect(JSON.stringify(foreignBody)).not.toContain("pinned");
  });
});
