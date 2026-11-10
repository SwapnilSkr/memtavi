import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createHarness, type Harness, hasTestDatabase } from "../support/harness";

interface Member {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string;
  createdAt: string;
}

interface MemberList {
  items: Member[];
  total: number;
  limit: number;
  offset: number;
}

describe.skipIf(!hasTestDatabase)("tenant members", () => {
  let harness: Harness;
  let runtime: Pool;
  let adminKey = "";
  let viewerKey = "";
  let developerKey = "";
  let ownIds: string[] = [];
  let foreignIds: string[] = [];
  const fixtureIds = Array.from({ length: 202 }, () => crypto.randomUUID()).sort();
  const createdAt = "2026-11-07T00:00:00.000Z";

  beforeAll(async () => {
    harness = await createHarness();
    runtime = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
    await harness.owner.query(
      `INSERT INTO users (id, email, name, image, password_hash, created_at)
       SELECT id, id::text || '@members.invalid', 'Member ' || ordinal,
         CASE WHEN ordinal = 1 THEN 'https://example.invalid/avatar.png' END,
         'fixture-password-hash', $2::timestamptz
       FROM unnest($1::uuid[]) WITH ORDINALITY AS fixture(id, ordinal)`,
      [fixtureIds, createdAt],
    );
    await harness.owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       SELECT $1, id, 'viewer' FROM unnest($2::uuid[]) AS fixture(id)`,
      [harness.tenants.a, fixtureIds],
    );
    const members = await harness.owner.query<{ user_id: string; tenant_id: string }>(
      `SELECT user_id, tenant_id FROM memberships
       WHERE tenant_id = ANY($1::uuid[]) ORDER BY user_id`,
      [[harness.tenants.a, harness.tenants.b]],
    );
    ownIds = members.rows
      .filter((member) => member.tenant_id === harness.tenants.a)
      .map((member) => member.user_id);
    foreignIds = members.rows
      .filter((member) => member.tenant_id === harness.tenants.b)
      .map((member) => member.user_id);
    for (const role of ["admin", "viewer", "developer"]) {
      const response = await harness.request("/v1/api-keys", {
        method: "POST",
        body: { name: `Members ${role}`, role },
      });
      expect(response.status).toBe(201);
      const key = (await response.json()) as { key: string };
      if (role === "admin") adminKey = key.key;
      if (role === "viewer") viewerKey = key.key;
      if (role === "developer") developerKey = key.key;
    }
  });

  afterAll(async () => {
    await runtime?.end();
    if (harness) {
      try {
        await harness.owner.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixtureIds]);
      } finally {
        await harness.close();
      }
    }
  });

  test("an admin lists only its tenant's members without a subject header", async () => {
    const response = await harness.request("/v1/members", { key: adminKey, subject: null });
    const body = (await response.json()) as MemberList;
    expect(body.items.some((member) => foreignIds.includes(member.id))).toBe(false);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body.total).toBe(203);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.items.map((member) => member.id)).toEqual(ownIds.slice(0, 50));
    const firstId = fixtureIds[0];
    if (!firstId) throw new Error("The member fixture is missing");
    const member = body.items.find((entry) => entry.id === firstId);
    expect(member).toEqual({
      id: firstId,
      email: `${firstId}@members.invalid`,
      name: "Member 1",
      image: "https://example.invalid/avatar.png",
      role: "viewer",
      createdAt,
    });
    expect(body.items.every((entry) => Object.keys(entry).length === 6)).toBe(true);
  });

  test("tenant B never receives tenant A's members", async () => {
    const response = await harness.request("/v1/members", { key: harness.keys.b, subject: null });
    const body = (await response.json()) as MemberList;
    expect(body.items.some((member) => ownIds.includes(member.id))).toBe(false);
    expect(response.status).toBe(200);
    expect(body.items.map((member) => member.id)).toEqual(foreignIds);
    expect(body.total).toBe(1);
    expect(body.items[0]?.role).toBe("owner");
    expect(body.items[0]?.image).toBeNull();
  });

  test("pagination keeps a deterministic order and the full total beyond the last page", async () => {
    for (const offset of [0, 1, 200, 203, 500]) {
      const response = await harness.request("/v1/members", {
        key: adminKey,
        query: { limit: 2, offset },
      });
      const body = (await response.json()) as MemberList;
      expect(body.items.some((member) => foreignIds.includes(member.id))).toBe(false);
      expect(response.status).toBe(200);
      expect(body.items.map((member) => member.id)).toEqual(ownIds.slice(offset, offset + 2));
      expect({ total: body.total, limit: body.limit, offset: body.offset }).toEqual({
        total: 203,
        limit: 2,
        offset,
      });
    }
    const response = await harness.request("/v1/members", { query: { limit: 200 } });
    const body = (await response.json()) as MemberList;
    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(200);
  });

  test.each([{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { offset: -1 }, { offset: 1.5 }])(
    "invalid pagination is rejected: %j",
    async (query) => {
      const response = await harness.request("/v1/members", { key: adminKey, query });
      expect(response.status).toBe(400);
    },
  );

  test("viewer and developer keys cannot list members", async () => {
    for (const key of [viewerKey, developerKey]) {
      const response = await harness.request("/v1/members", { key });
      const body = (await response.json()) as { message: string; body: { error: string } };
      expect(JSON.stringify(body).includes(foreignIds[0] ?? "missing")).toBe(false);
      expect(response.status).toBe(403);
      expect(body.message).toBe("Forbidden");
      expect(body.body.error).toBe("ForbiddenError");
      expect(response.headers.get("x-request-id")).toBeTruthy();
    }
  });

  test("missing and invalid API keys cannot list members", async () => {
    for (const key of [null, "mtv_live_invalid_members_key"]) {
      const response = await harness.request("/v1/members", { key });
      expect(response.status).toBe(401);
    }
  });

  test("the function fails closed before scope and after both commit and rollback", async () => {
    expect((await runtime.query("SELECT * FROM public.list_members()")).rows).toEqual([]);
    const client = await runtime.connect();
    try {
      for (const end of ["COMMIT", "ROLLBACK"]) {
        await client.query("BEGIN");
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [harness.tenants.a]);
          const result = await client.query<{ id: string }>("SELECT * FROM public.list_members()");
          expect(result.rows.some((member) => foreignIds.includes(member.id))).toBe(false);
          expect(result.rows.map((member) => member.id)).toEqual(ownIds.slice(0, 50));
        } finally {
          await client.query(end);
        }
        expect((await client.query("SELECT * FROM public.list_members()")).rows).toEqual([]);
      }
    } finally {
      client.release();
    }
  });

  test("the function bounds direct runtime calls and resists temporary table shadowing", async () => {
    const client = await runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [harness.tenants.a]);
      await client.query("CREATE TEMP TABLE memberships (tenant_id uuid, user_id uuid, role text)");
      await client.query("CREATE TEMP TABLE users (id uuid, email text, name text, image text)");
      for (const [limit, offset, expected] of [
        [null, null, 50],
        [1000, 0, 200],
        [0, -1, 1],
      ]) {
        const result = await client.query<{ id: string }>(
          "SELECT * FROM public.list_members($1, $2)",
          [limit, offset],
        );
        expect(result.rows.some((member) => foreignIds.includes(member.id))).toBe(false);
        expect(result.rows).toHaveLength(expected ?? 0);
        expect(result.rows[0]?.id).toBe(ownIds[0]);
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  test("the runtime still cannot read users or tenants directly", async () => {
    for (const table of ["users", "tenants"]) {
      await expect(runtime.query(`SELECT * FROM public.${table}`)).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  test("only the runtime and migration owner can execute the pinned definer function", async () => {
    const result = await harness.owner.query<{
      owner: string;
      migration_owner: string;
      definer: boolean;
      config: string[];
      grantees: string[];
    }>(
      `SELECT pg_get_userbyid(p.proowner) AS owner,
         pg_get_userbyid(c.relowner) AS migration_owner,
         p.prosecdef AS definer, p.proconfig AS config,
         ARRAY(SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)::text
           FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE' ORDER BY 1) AS grantees
       FROM pg_proc p CROSS JOIN pg_class c
       WHERE p.oid = 'public.list_members(integer,integer)'::regprocedure
         AND c.oid = 'public.schema_migrations'::regclass`,
    );
    const metadata = result.rows[0];
    if (!metadata) throw new Error("The members function is missing");
    expect(metadata.definer).toBe(true);
    expect(metadata.owner).toBe(metadata.migration_owner);
    expect(metadata.owner).not.toBe("memtavi_app");
    expect(metadata.config).toEqual(["search_path=pg_catalog, pg_temp"]);
    expect(metadata.grantees).toEqual([metadata.owner, "memtavi_app"].sort());
  });
});
