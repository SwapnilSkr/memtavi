import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@memtavi/shared/ids";
import { Pool, type PoolClient } from "pg";

const searchSql = "SELECT * FROM public.search_pages_keyword($1, $2, $3)";

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_APP_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL and TEST_APP_DATABASE_URL are required");
}

describe("keyword search with tenant RLS", () => {
  const owner = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const runtime = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
  const tenant = crypto.randomUUID();
  const foreignTenant = crypto.randomUUID();
  const subject = crypto.randomUUID();
  const foreignSubject = crypto.randomUUID();
  const brain = newId("brain");
  const otherBrain = newId("brain");
  const subjectBrain = newId("brain");
  const tenantBrain = newId("brain");
  let seeded = false;

  async function withScope<T>(
    tenantId: string | undefined,
    subjectId: string | undefined,
    run: (client: PoolClient) => Promise<T>,
    connectionPool = runtime,
  ): Promise<T> {
    const client = await connectionPool.connect();
    try {
      await client.query("BEGIN");
      if (tenantId !== undefined) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }
      if (subjectId !== undefined) {
        await client.query("SELECT set_config('app.subject_id', $1, true)", [subjectId]);
      }
      return await run(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  beforeAll(async () => {
    const database = (await owner.query("SELECT current_database() AS name")).rows[0]?.name;
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database ?? "")) {
      throw new Error("Keyword search fixtures require a disposable memtavi_test database");
    }
    const role = (
      await runtime.query(
        `SELECT current_database() AS name, current_user AS role, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
      )
    ).rows[0];
    expect(role).toEqual({
      name: database,
      role: "memtavi_app",
      rolsuper: false,
      rolbypassrls: false,
    });
    await owner.query(
      "INSERT INTO tenants (id, name, slug) SELECT id, 'FTS', id::text FROM unnest($1::uuid[]) AS id",
      [[tenant, foreignTenant]],
    );
    seeded = true;
    for (const [tenantId, subjectId, brainId] of [
      [tenant, subject, brain],
      [tenant, subject, otherBrain],
      [tenant, foreignSubject, subjectBrain],
      [foreignTenant, foreignSubject, tenantBrain],
    ]) {
      await owner.query(
        "INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [tenantId, subjectId],
      );
      await owner.query(
        "INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, 'FTS', $1)",
        [brainId, tenantId, subjectId],
      );
      await owner.query(
        `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash)
         VALUES ($1, $2, $3, $4, 'needle', 'needle', 'fixture')`,
        [newId("page"), tenantId, subjectId, brainId],
      );
    }
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, summary, body, content_hash)
       SELECT 'pg_' || md5($3 || n::text), $1, $2, $3, 'rank-' || lpad(n::text, 3, '0'),
         CASE WHEN n % 3 = 0 THEN 'needle' ELSE 'Fixture' END,
         CASE WHEN n % 3 = 1 THEN 'needle' ELSE '' END,
         CASE WHEN n % 3 = 2 THEN 'needle' ELSE '' END, 'fixture'
       FROM generate_series(1, 204) AS n`,
      [tenant, subject, brain],
    );
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, summary, content_hash)
       SELECT 'pg_' || md5($3 || '-filler-' || n), $1, $2, $3, 'filler-' || n,
         'Synthetic page ' || n, 'alpha' || (n % 100), 'fixture'
       FROM generate_series(1, 10000) AS n`,
      [tenant, subject, brain],
    );
    await owner.query(
      `INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash, deletion_state)
       VALUES ($1, $2, $3, $4, 'deleted', 'needle deletedonly', 'fixture', 'deleted')`,
      [newId("page"), tenant, subject, brain],
    );
    await owner.query("ANALYZE public.pages");
  });

  afterAll(async () => {
    try {
      if (seeded) {
        await owner.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [
          [tenant, foreignTenant],
        ]);
      }
    } finally {
      await Promise.all([owner.end(), runtime.end()]);
    }
  });

  test("matching foreign tenants, subjects and brains are excluded before own results", async () => {
    await withScope(tenant, subject, async (client) => {
      for (const foreignBrain of [tenantBrain, subjectBrain]) {
        expect((await client.query(searchSql, [foreignBrain, "needle", 200])).rows).toEqual([]);
      }
      expect((await client.query(searchSql, [brain, "deletedonly", 20])).rows).toEqual([]);
      const actual = (await client.query(searchSql, [brain, "needle", 200])).rows;
      const expected = (
        await owner.query(
          `SELECT p.id AS "pageId", p.slug, p.title, p.summary, p.page_type::text AS "pageType",
             ts_rank(p.search_tsv, websearch_to_tsquery('english', $4)) AS rank,
             COALESCE(p.last_compiled_at, p.last_referenced_at, to_timestamp(0)) AS "updatedAt"
           FROM public.pages p
           WHERE p.tenant_id = $1 AND p.subject_id = $2 AND p.brain_id = $3
             AND p.deletion_state = 'active'
             AND p.search_tsv @@ websearch_to_tsquery('english', $4)
           ORDER BY rank DESC, p.slug, p.id LIMIT 200`,
          [tenant, subject, brain, "needle"],
        )
      ).rows;
      expect(actual).toEqual(expected);
      expect(actual).toHaveLength(200);
      expect(actual.some((row) => row.slug === "deleted")).toBe(false);
    });
    await withScope(foreignTenant, foreignSubject, async (client) => {
      expect((await client.query(searchSql, [brain, "needle", 20])).rows).toEqual([]);
      expect((await client.query(searchSql, [tenantBrain, "needle", 20])).rows).toHaveLength(1);
    });
  });

  test.each([undefined, ""])("missing or empty tenant fails closed: %s", async (tenantId) => {
    const unscoped = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
    try {
      await withScope(
        tenantId,
        subject,
        async (client) => {
          expect((await client.query(searchSql, [brain, "needle", 20])).rows).toEqual([]);
          expect(
            (await client.query("SELECT current_setting('app.tenant_id', true) AS tenant")).rows[0]
              ?.tenant,
          ).toBe(tenantId ?? null);
        },
        unscoped,
      );
    } finally {
      await unscoped.end();
    }
  });

  test.each([undefined, ""])(
    "unscoped subjects retain the tenant-only pages policy: %s",
    async (subjectId) => {
      await withScope(tenant, subjectId, async (client) => {
        expect((await client.query(searchSql, [tenantBrain, "needle", 20])).rows).toEqual([]);
        const visible = (
          await client.query("SELECT id FROM public.pages WHERE brain_id = $1", [subjectBrain])
        ).rows;
        const results = (await client.query(searchSql, [subjectBrain, "needle", 20])).rows;
        expect(results.map((row) => row.pageId)).toEqual(visible.map((row) => row.id));
        expect(results).toHaveLength(1);
      });
    },
  );

  test("direct calls clamp limits and cannot shadow the pages table", async () => {
    await withScope(tenant, subject, async (client) => {
      expect((await client.query(searchSql, [subjectBrain, "needle", 200])).rows).toEqual([]);
      await client.query("CREATE TEMP TABLE pages (search_tsv tsvector)");
      for (const [limit, expected] of [
        [null, 20],
        [0, 1],
        [-1, 1],
        [1000, 200],
      ]) {
        expect((await client.query(searchSql, [brain, "needle", limit])).rows).toHaveLength(
          expected ?? 0,
        );
      }
    });
  });

  test("PUBLIC cannot execute the pinned stable definer function", async () => {
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      const role = `fts_public_${crypto.randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(`SET LOCAL ROLE ${role}`);
      await expect(client.query(searchSql, [brain, "needle", 20])).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const metadata = (
      await owner.query(
        `SELECT p.prosecdef AS definer, p.provolatile AS volatility, p.proconfig AS config,
         pg_get_userbyid(p.proowner) AS owner,
         pg_get_userbyid(c.relowner) AS table_owner,
         ARRAY(SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)::text
           FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE' ORDER BY 1) AS grantees
       FROM pg_proc p CROSS JOIN pg_class c
       WHERE p.oid = 'public.search_pages_keyword(text,text,integer)'::regprocedure
         AND c.oid = 'public.pages'::regclass`,
      )
    ).rows[0];
    expect(metadata.definer).toBe(true);
    expect(metadata.volatility).toBe("s");
    expect(metadata.config).toEqual(["search_path=pg_catalog, pg_temp"]);
    expect(metadata.owner).toBe(metadata.table_owner);
    expect(metadata.owner).not.toBe("memtavi_app");
    expect(metadata.grantees).toEqual([metadata.owner, "memtavi_app"].sort());
    expect(
      (
        await owner.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pages'::regclass",
        )
      ).rows[0]?.relrowsecurity,
    ).toBe(true);
    expect(
      (
        await owner.query(
          "SELECT proleakproof FROM pg_proc WHERE oid = 'ts_match_vq(tsvector,tsquery)'::regprocedure",
        )
      ).rows[0]?.proleakproof,
    ).toBe(false);
  });

  test("an app-role function call reaches the GIN bitmap index with default planner settings", async () => {
    const client = await owner.connect();
    const plans: string[] = [];
    const onNotice = (notice: { message?: string | undefined }) => {
      if (notice.message?.includes("plan:")) plans.push(notice.message);
    };
    client.on("notice", onNotice);
    try {
      await client.query("LOAD 'auto_explain'");
      await client.query("BEGIN");
      await client.query("SET LOCAL auto_explain.log_min_duration = 0");
      await client.query("SET LOCAL auto_explain.log_nested_statements = on");
      await client.query("SET LOCAL auto_explain.log_analyze = on");
      await client.query("SET LOCAL auto_explain.log_buffers = on");
      await client.query("SET LOCAL auto_explain.log_format = json");
      await client.query("SET LOCAL auto_explain.log_level = notice");
      await client.query("SET LOCAL ROLE memtavi_app");
      expect((await client.query("SELECT current_user AS role")).rows[0]?.role).toBe("memtavi_app");
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.subject_id', $2, true)",
        [tenant, subject],
      );
      expect((await client.query("SHOW enable_seqscan")).rows[0]?.enable_seqscan).toBe("on");
      const explain = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${searchSql}`, [
        brain,
        "alpha42",
        20,
      ]);
      expect(JSON.stringify(explain.rows)).toContain("Function Scan");
      const nested = plans
        .map((message) => JSON.parse(message.slice(message.indexOf("{"))))
        .find((plan) => JSON.stringify(plan.Plan).includes('"Index Name":"pages_search_tsv_gin"'));
      expect(nested).toBeDefined();
      expect(JSON.stringify(nested.Plan)).toContain('"Node Type":"Bitmap Index Scan"');
      process.stdout.write(
        `keyword nested app-role plan (enable_seqscan=on):\n${JSON.stringify(nested, null, 2)}\n`,
      );
    } finally {
      await client.query("ROLLBACK");
      client.removeListener("notice", onNotice);
      client.release(true);
    }
  });
});
