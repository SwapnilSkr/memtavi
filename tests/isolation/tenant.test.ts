import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@memtavi/shared/ids";
import { Client, Pool } from "pg";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("tenant isolation", () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const subjectA = crypto.randomUUID();
  const subjectB = crypto.randomUUID();
  const brainA = newId("brain");
  const brainB = newId("brain");
  const pageA = newId("page");
  const pageB = newId("page");
  const sourceA = newId("source");
  const sourceB = newId("source");
  const eventA = newId("change");
  const eventB = newId("change");
  const webhookA = crypto.randomUUID();
  const webhookB = crypto.randomUUID();
  const childTables = [
    "page_versions",
    "page_sources",
    "page_embeddings",
    "score_snapshots",
    "briefs",
    "webhook_deliveries",
    "memory_settings",
  ] as const;
  const embedding = JSON.stringify(Array.from({ length: 1536 }, () => 0));
  const owner = new Pool({ connectionString: ownerUrl });
  let db: typeof import("@memtavi/db/client");
  let fixturesAuthorized = false;
  const previousAppUrl = process.env.APP_DATABASE_URL;

  beforeAll(async () => {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(database.rows[0]?.name ?? "")) {
      throw new Error("Isolation fixtures require a disposable memtavi_test database");
    }
    const application = new Client({ connectionString: appUrl });
    await application.connect();
    try {
      const role = await application.query<{
        name: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        "SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(role.rows[0]).toEqual({ name: "memtavi_app", rolsuper: false, rolbypassrls: false });
      const appDatabase = await application.query<{ name: string }>(
        "SELECT current_database() AS name",
      );
      expect(appDatabase.rows[0]?.name).toBe(database.rows[0]?.name);
    } finally {
      await application.end();
    }
    process.env.APP_DATABASE_URL = appUrl;
    db = await import("@memtavi/db/client");
    fixturesAuthorized = true;
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO tenants (id, name, slug) VALUES ($1, 'Isolation A', $2), ($3, 'Isolation B', $4)",
        [tenantA, `isolation-${tenantA}`, tenantB, `isolation-${tenantB}`],
      );
      await client.query(
        "INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1, $2), ($3, $4)",
        [tenantA, subjectA, tenantB, subjectB],
      );
      await client.query(
        "INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, 'Brain A', 'isolation'), ($4, $5, $6, 'Brain B', 'isolation')",
        [brainA, tenantA, subjectA, brainB, tenantB, subjectB],
      );
      for (const fixture of [
        {
          tenant: tenantA,
          subject: subjectA,
          brain: brainA,
          page: pageA,
          source: sourceA,
          event: eventA,
          webhook: webhookA,
        },
        {
          tenant: tenantB,
          subject: subjectB,
          brain: brainB,
          page: pageB,
          source: sourceB,
          event: eventB,
          webhook: webhookB,
        },
      ]) {
        await client.query("INSERT INTO memory_settings (tenant_id, subject_id) VALUES ($1, $2)", [
          fixture.tenant,
          fixture.subject,
        ]);
        await client.query(
          "INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, summary, body, content_hash) VALUES ($1, $2, $3, $4, 'isolation-page', 'Alpha', 'Beta', 'Gamma', 'fixture-hash')",
          [fixture.page, fixture.tenant, fixture.subject, fixture.brain],
        );
        await client.query(
          "INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash, affected_page_ids) VALUES ($1, $2, $3, $4, 'note', 'Fixture', 'fixture-hash', $5)",
          [fixture.source, fixture.tenant, fixture.subject, fixture.brain, [fixture.page]],
        );
        await client.query(
          "INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor, ingest_source_id) VALUES ($1, $2, 1, 'Alpha', 'Beta', 'Gamma', 'user', $3)",
          [fixture.tenant, fixture.page, fixture.source],
        );
        await client.query(
          "INSERT INTO page_sources (tenant_id, page_id, ingest_source_id) VALUES ($1, $2, $3)",
          [fixture.tenant, fixture.page, fixture.source],
        );
        await client.query(
          "INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash) VALUES ($1, $2, 'fixture', 1536, $3, 'fixture-hash')",
          [fixture.tenant, fixture.page, embedding],
        );
        await client.query(
          "INSERT INTO score_snapshots (tenant_id, brain_id, freshness, readiness, strain, factors) VALUES ($1, $2, 1, 1, 0, '{}')",
          [fixture.tenant, fixture.brain],
        );
        await client.query(
          "INSERT INTO briefs (tenant_id, brain_id, page_id, for_date) VALUES ($1, $2, $3, '2026-01-01')",
          [fixture.tenant, fixture.brain, fixture.page],
        );
        await client.query(
          "INSERT INTO change_events (id, tenant_id, brain_id, page_id, action, change_summary, to_version) VALUES ($1, $2, $3, $4, 'created', 'Fixture', 1)",
          [fixture.event, fixture.tenant, fixture.brain, fixture.page],
        );
        await client.query(
          "INSERT INTO webhooks (id, tenant_id, subject_id, url, events, secret_enc) VALUES ($1, $2, $3, 'https://example.invalid', '{}', 'fixture')",
          [fixture.webhook, fixture.tenant, fixture.subject],
        );
        await client.query(
          "INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, payload) VALUES ($1, $2, $3, '{}')",
          [fixture.tenant, fixture.webhook, fixture.event],
        );
        await client.query(
          "INSERT INTO routing_reviews (tenant_id, brain_id, ingest_source_id, fact, candidate_page_ids) VALUES ($1, $2, $3, '{}', $4)",
          [fixture.tenant, fixture.brain, fixture.source, [fixture.page]],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    try {
      if (fixturesAuthorized) {
        await owner.query("DELETE FROM tenants WHERE id IN ($1, $2)", [tenantA, tenantB]);
      }
    } finally {
      await owner.end();
      if (db) await db.pool.end();
      if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
      else process.env.APP_DATABASE_URL = previousAppUrl;
    }
  });

  test("an unset tenant sees no brains", async () => {
    const client = new Client({ connectionString: appUrl });
    await client.connect();
    try {
      const foreign = await client.query("SELECT id FROM brains WHERE id IN ($1, $2)", [
        brainA,
        brainB,
      ]);
      expect(foreign.rows).toEqual([]);
      expect((await client.query("SELECT id FROM brains")).rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  test.each([
    { tenant: tenantA, ownBrain: brainA, foreignBrain: brainB },
    { tenant: tenantB, ownBrain: brainB, foreignBrain: brainA },
  ])("$tenant sees only its own brain", async ({ tenant, ownBrain, foreignBrain }) => {
    await db.withTenant(tenant, async (client) => {
      const foreign = await client.query("SELECT id FROM brains WHERE tenant_id = $1 AND id = $2", [
        tenant,
        foreignBrain,
      ]);
      expect(foreign.rows).toEqual([]);
      expect(
        (await client.query("SELECT id FROM brains WHERE id = $1", [foreignBrain])).rows,
      ).toEqual([]);
      const own = await client.query("SELECT id FROM brains WHERE tenant_id = $1 AND id = $2", [
        tenant,
        ownBrain,
      ]);
      expect(own.rows).toEqual([{ id: ownBrain }]);
      expect((await client.query("SELECT id FROM brains ORDER BY id")).rows).toEqual([
        { id: ownBrain },
      ]);
    });
  });

  for (const table of childTables) {
    test.each([
      { tenant: tenantA, foreignTenant: tenantB },
      { tenant: tenantB, foreignTenant: tenantA },
    ])(`${table} exposes only $tenant rows`, async ({ tenant, foreignTenant }) => {
      await db.withTenant(tenant, async (client) => {
        expect(
          (
            await client.query(`SELECT tenant_id FROM ${table} WHERE tenant_id = $1`, [
              foreignTenant,
            ])
          ).rows,
        ).toEqual([]);
        expect((await client.query(`SELECT tenant_id FROM ${table}`)).rows).toEqual([
          { tenant_id: tenant },
        ]);
        expect(
          (await client.query(`SELECT tenant_id FROM ${table} WHERE tenant_id = $1`, [tenant]))
            .rows,
        ).toEqual([{ tenant_id: tenant }]);
      });
    });

    test(`${table} fails closed without tenant scope`, async () => {
      expect(
        (await db.pool.query(`SELECT tenant_id FROM ${table} WHERE tenant_id = $1`, [tenantB]))
          .rows,
      ).toEqual([]);
      expect((await db.pool.query(`SELECT tenant_id FROM ${table}`)).rows).toEqual([]);
    });

    test(`${table} rejects a cross-tenant update`, async () => {
      await db.withTenant(tenantA, async (client) => {
        if (table === "page_versions") {
          await expect(
            client.query("UPDATE page_versions SET title = 'Forbidden' WHERE tenant_id = $1", [
              tenantB,
            ]),
          ).rejects.toMatchObject({ code: "42501" });
        } else {
          const result = await client.query(
            `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1`,
            [tenantB],
          );
          expect(result.rowCount).toBe(0);
        }
      });
    });
  }

  test("memory settings reject inserts for another tenant", async () => {
    await expect(
      db.withTenant(tenantB, async (client) => {
        expect(
          (
            await client.query("SELECT subject_id FROM memory_settings WHERE tenant_id = $1", [
              tenantA,
            ])
          ).rows,
        ).toEqual([]);
        await client.query(
          "INSERT INTO memory_settings (tenant_id, subject_id, mode) VALUES ($1, $2, 'off')",
          [tenantA, subjectB],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("memory settings reject moving an own row into another tenant", async () => {
    await expect(
      db.withTenant(tenantB, async (client) => {
        expect(
          (
            await client.query("SELECT subject_id FROM memory_settings WHERE tenant_id = $1", [
              tenantA,
            ])
          ).rows,
        ).toEqual([]);
        await client.query(
          "UPDATE memory_settings SET tenant_id = $1 WHERE tenant_id = $2 AND subject_id = $3",
          [tenantA, tenantB, subjectB],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("memory settings reject cross-tenant deletes", async () => {
    await db.withTenant(tenantB, async (client) => {
      expect(
        (
          await client.query("SELECT subject_id FROM memory_settings WHERE tenant_id = $1", [
            tenantA,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (await client.query("DELETE FROM memory_settings WHERE tenant_id = $1", [tenantA]))
          .rowCount,
      ).toBe(0);
    });
    expect(
      (
        await owner.query(
          "SELECT mode FROM memory_settings WHERE tenant_id = $1 AND subject_id = $2",
          [tenantA, subjectA],
        )
      ).rows,
    ).toEqual([{ mode: "auto" }]);
  });

  test("memory settings allow own-tenant CRUD with an auto default", async () => {
    const rollback = new Error("Discard memory settings fixture");
    await expect(
      db.withTenant(tenantA, async (client) => {
        expect(
          (
            await client.query("SELECT subject_id FROM memory_settings WHERE tenant_id = $1", [
              tenantB,
            ])
          ).rows,
        ).toEqual([]);
        await client.query("INSERT INTO memory_settings (tenant_id, subject_id) VALUES ($1, $2)", [
          tenantA,
          subjectB,
        ]);
        expect(
          (
            await client.query(
              "SELECT mode, updated_by, updated_at IS NOT NULL AS has_timestamp FROM memory_settings WHERE tenant_id = $1 AND subject_id = $2",
              [tenantA, subjectB],
            )
          ).rows,
        ).toEqual([{ mode: "auto", updated_by: null, has_timestamp: true }]);
        for (const mode of ["ask", "off"]) {
          expect(
            (
              await client.query(
                "UPDATE memory_settings SET mode = $1 WHERE tenant_id = $2 AND subject_id = $3 RETURNING mode",
                [mode, tenantA, subjectB],
              )
            ).rows,
          ).toEqual([{ mode }]);
        }
        expect(
          (
            await client.query(
              "DELETE FROM memory_settings WHERE tenant_id = $1 AND subject_id = $2",
              [tenantA, subjectB],
            )
          ).rowCount,
        ).toBe(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  const childInserts = [
    {
      table: "page_versions",
      sql: "INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor, ingest_source_id) VALUES ($1, $2, 2, 'Fixture', '', '', 'user', $3)",
      foreign: [pageB, sourceB],
      mixed: [
        [pageB, sourceA],
        [pageA, sourceB],
      ],
    },
    {
      table: "page_sources",
      sql: "INSERT INTO page_sources (tenant_id, page_id, ingest_source_id) VALUES ($1, $2, $3)",
      foreign: [pageB, sourceB],
      mixed: [
        [pageB, sourceA],
        [pageA, sourceB],
      ],
    },
    {
      table: "page_embeddings",
      sql: "INSERT INTO page_embeddings (tenant_id, page_id, model, dimensions, embedding, content_hash) VALUES ($1, $2, 'new-fixture', 1536, $3, 'fixture-hash')",
      foreign: [pageB, embedding],
      mixed: [[pageB, embedding]],
    },
    {
      table: "score_snapshots",
      sql: "INSERT INTO score_snapshots (tenant_id, brain_id, freshness, readiness, strain, factors) VALUES ($1, $2, 1, 1, 0, '{}')",
      foreign: [brainB],
      mixed: [[brainB]],
    },
    {
      table: "briefs",
      sql: "INSERT INTO briefs (tenant_id, brain_id, page_id, for_date) VALUES ($1, $2, $3, '2026-01-02')",
      foreign: [brainB, pageB],
      mixed: [
        [brainB, pageA],
        [brainA, pageB],
      ],
    },
    {
      table: "webhook_deliveries",
      sql: "INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, payload) VALUES ($1, $2, $3, '{}')",
      foreign: [webhookB, eventB],
      mixed: [
        [webhookB, eventA],
        [webhookA, eventB],
      ],
    },
  ];

  test.each(childInserts)("$table rejects writes for another tenant", async (fixture) => {
    await expect(
      db.withTenant(tenantA, async (client) => {
        expect(
          (
            await client.query(`SELECT tenant_id FROM ${fixture.table} WHERE tenant_id = $1`, [
              tenantB,
            ])
          ).rows,
        ).toEqual([]);
        await client.query(fixture.sql, [tenantB, ...fixture.foreign]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  for (const fixture of childInserts) {
    test.each(fixture.mixed)(
      `${fixture.table} rejects a parent from another tenant: %j`,
      async (...parents) => {
        await expect(
          db.withTenant(tenantA, async (client) => {
            expect(
              (
                await client.query(`SELECT tenant_id FROM ${fixture.table} WHERE tenant_id = $1`, [
                  tenantB,
                ])
              ).rows,
            ).toEqual([]);
            await client.query(fixture.sql, [tenantA, ...parents]);
          }),
        ).rejects.toMatchObject({ code: "23503" });
      },
    );
  }

  test("a deleted source clears the version source without clearing tenant scope", async () => {
    const rollback = new Error("Discard source deletion fixture");
    await expect(
      db.withTenant(tenantA, async (client) => {
        expect(
          (await client.query("SELECT page_id FROM page_versions WHERE page_id = $1", [pageB]))
            .rows,
        ).toEqual([]);
        const source = newId("source");
        await client.query(
          "INSERT INTO ingest_sources (id, tenant_id, subject_id, brain_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, 'note', 'Fixture', 'fixture-hash')",
          [source, tenantA, subjectA, brainA],
        );
        await client.query(
          "INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor, ingest_source_id) VALUES ($1, $2, 3, 'Fixture', '', '', 'user', $3)",
          [tenantA, pageA, source],
        );
        await client.query("DELETE FROM ingest_sources WHERE tenant_id = $1 AND id = $2", [
          tenantA,
          source,
        ]);
        expect(
          (
            await client.query(
              "SELECT tenant_id, ingest_source_id FROM page_versions WHERE tenant_id = $1 AND page_id = $2 AND version = 3",
              [tenantA, pageA],
            )
          ).rows,
        ).toEqual([{ tenant_id: tenantA, ingest_source_id: null }]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  test.each(["users", "tenants"] as const)("the runtime cannot read %s", async (table) => {
    await expect(
      db.withTenant(tenantA, async (client) => {
        await client.query(`SELECT * FROM ${table}`);
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await owner.query("SELECT has_table_privilege('memtavi_app', $1, 'SELECT') AS allowed", [
          table,
        ])
      ).rows,
    ).toEqual([{ allowed: false }]);
  });

  test("a deleted page slug can be reused", async () => {
    await db.withTenant(tenantA, async (client) => {
      expect((await client.query("SELECT id FROM pages WHERE id = $1", [pageB])).rows).toEqual([]);
      await client.query(
        "UPDATE pages SET deletion_state = 'deleted' WHERE tenant_id = $1 AND id = $2",
        [tenantA, pageA],
      );
      const replacement = newId("page");
      await client.query(
        "INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash) VALUES ($1, $2, $3, $4, 'isolation-page', 'Replacement', 'fixture-hash')",
        [replacement, tenantA, subjectA, brainA],
      );
      expect(
        (
          await client.query(
            "SELECT id FROM pages WHERE tenant_id = $1 AND brain_id = $2 AND slug = 'isolation-page' AND deletion_state = 'active'",
            [tenantA, brainA],
          )
        ).rows,
      ).toEqual([{ id: replacement }]);
      await client.query("DELETE FROM pages WHERE tenant_id = $1 AND id = $2", [
        tenantA,
        replacement,
      ]);
      await client.query(
        "UPDATE pages SET deletion_state = 'active' WHERE tenant_id = $1 AND id = $2",
        [tenantA, pageA],
      );
    });
  });

  test("an active page slug cannot be duplicated", async () => {
    await expect(
      db.withTenant(tenantA, async (client) => {
        expect((await client.query("SELECT id FROM pages WHERE id = $1", [pageB])).rows).toEqual(
          [],
        );
        await client.query(
          "INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash) VALUES ($1, $2, $3, $4, 'isolation-page', 'Duplicate', 'fixture-hash')",
          [newId("page"), tenantA, subjectA, brainA],
        );
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("search weights distinguish title, summary and body", async () => {
    await db.withTenant(tenantA, async (client) => {
      expect(
        (await client.query("SELECT search_tsv::text FROM pages WHERE id = $1", [pageB])).rows,
      ).toEqual([]);
      expect(
        (
          await client.query(
            "SELECT search_tsv::text FROM pages WHERE tenant_id = $1 AND id = $2",
            [tenantA, pageA],
          )
        ).rows,
      ).toEqual([{ search_tsv: "'alpha':1A 'beta':2B 'gamma':3C" }]);
    });
  });

  test("page ID arrays preserve prefixed text IDs", async () => {
    await db.withTenant(tenantA, async (client) => {
      expect(
        (
          await client.query("SELECT affected_page_ids FROM ingest_sources WHERE id = $1", [
            sourceB,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await client.query(
            "SELECT affected_page_ids FROM ingest_sources WHERE tenant_id = $1 AND id = $2",
            [tenantA, sourceA],
          )
        ).rows,
      ).toEqual([{ affected_page_ids: [pageA] }]);
      expect(
        (
          await client.query(
            "SELECT candidate_page_ids FROM routing_reviews WHERE tenant_id = $1",
            [tenantB],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await client.query(
            "SELECT candidate_page_ids FROM routing_reviews WHERE tenant_id = $1",
            [tenantA],
          )
        ).rows,
      ).toEqual([{ candidate_page_ids: [pageA] }]);
    });
  });

  test("subject scope is bound inside the tenant transaction and cleared on commit", async () => {
    const subject = `${subjectA}'quoted`;
    await db.withTenant(
      tenantA,
      async (client) => {
        expect((await client.query("SELECT id FROM brains WHERE id = $1", [brainB])).rows).toEqual(
          [],
        );
        expect(
          (
            await client.query(
              "SELECT current_setting('app.tenant_id') AS tenant, current_setting('app.subject_id') AS subject",
            )
          ).rows,
        ).toEqual([{ tenant: tenantA, subject }]);
      },
      subject,
    );
    expect(
      (await db.pool.query("SELECT NULLIF(current_setting('app.subject_id', true), '') AS subject"))
        .rows,
    ).toEqual([{ subject: null }]);
  });

  test("subject scope is cleared on rollback", async () => {
    const failure = new Error("Subject rollback");
    await expect(
      db.withTenant(
        tenantA,
        async (client) => {
          expect(
            (await client.query("SELECT id FROM brains WHERE id = $1", [brainB])).rows,
          ).toEqual([]);
          expect(
            (await client.query("SELECT current_setting('app.subject_id') AS subject")).rows,
          ).toEqual([{ subject: subjectA }]);
          throw failure;
        },
        subjectA,
      ),
    ).rejects.toBe(failure);
    expect(
      (await db.pool.query("SELECT NULLIF(current_setting('app.subject_id', true), '') AS subject"))
        .rows,
    ).toEqual([{ subject: null }]);
  });

  test.each([undefined, "", "  "])(
    "an empty or omitted subject leaves no scope: %s",
    async (subject) => {
      await db.withTenant(
        tenantA,
        async (client) => {
          expect(
            (await client.query("SELECT id FROM brains WHERE id = $1", [brainB])).rows,
          ).toEqual([]);
          expect(
            (
              await client.query(
                "SELECT NULLIF(current_setting('app.subject_id', true), '') AS subject",
              )
            ).rows,
          ).toEqual([{ subject: null }]);
        },
        subject,
      );
    },
  );

  test("a cross-tenant update changes zero rows", async () => {
    await db.withTenant(tenantA, async (client) => {
      const result = await client.query("UPDATE brains SET name = 'Forbidden' WHERE id = $1", [
        brainB,
      ]);
      expect(result.rowCount).toBe(0);
    });
    expect((await owner.query("SELECT name FROM brains WHERE id = $1", [brainB])).rows).toEqual([
      { name: "Brain B" },
    ]);
  });

  test("a cross-tenant insert is rejected by RLS", async () => {
    await expect(
      db.withTenant(tenantA, async (client) => {
        await client.query(
          "INSERT INTO brains (id, tenant_id, subject_id, name, slug) VALUES ($1, $2, $3, 'Forbidden', 'forbidden')",
          [newId("brain"), tenantB, subjectB],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("a child cannot reference another tenant's brain", async () => {
    await expect(
      db.withTenant(tenantA, async (client) => {
        await client.query(
          "INSERT INTO pages (id, tenant_id, subject_id, brain_id, slug, title, content_hash) VALUES ($1, $2, $3, $4, 'forbidden', 'Forbidden', 'fixture-hash')",
          [newId("page"), tenantA, subjectA, brainB],
        );
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  test("a tenant cannot be changed to another tenant", async () => {
    await expect(
      db.withTenant(tenantA, async (client) => {
        await client.query("UPDATE brains SET tenant_id = $1 WHERE id = $2", [tenantB, brainA]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("a failed callback rolls back its writes and tenant setting", async () => {
    const failure = new Error("Fixture rollback");
    await expect(
      db.withTenant(tenantA, async (client) => {
        expect((await client.query("SELECT id FROM brains WHERE id = $1", [brainB])).rows).toEqual(
          [],
        );
        await client.query(
          "UPDATE brains SET name = 'Rolled back' WHERE tenant_id = $1 AND id = $2",
          [tenantA, brainA],
        );
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect((await db.pool.query("SELECT id FROM brains")).rows).toEqual([]);
    expect((await owner.query("SELECT name FROM brains WHERE id = $1", [brainA])).rows).toEqual([
      { name: "Brain A" },
    ]);
  });

  test("a committed callback does not leave tenant scope on a pooled connection", async () => {
    const result = await db.withTenant(tenantA, async (client) => {
      expect((await client.query("SELECT id FROM brains WHERE id = $1", [brainB])).rows).toEqual(
        [],
      );
      await client.query("UPDATE brains SET name = 'Committed' WHERE tenant_id = $1 AND id = $2", [
        tenantA,
        brainA,
      ]);
      return "committed";
    });
    expect(result).toBe("committed");
    expect((await db.pool.query("SELECT id FROM brains")).rows).toEqual([]);
    expect((await owner.query("SELECT name FROM brains WHERE id = $1", [brainA])).rows).toEqual([
      { name: "Committed" },
    ]);
    await owner.query("UPDATE brains SET name = 'Brain A' WHERE id = $1", [brainA]);
  });

  test("an empty tenant id is rejected before its callback", async () => {
    let called = false;
    await expect(
      db.withTenant("  ", async () => {
        called = true;
      }),
    ).rejects.toThrow("tenantId is required");
    expect(called).toBe(false);
  });

  test.each(["UPDATE", "DELETE"] as const)(
    "page versions reject %s for the application role",
    async (operation) => {
      await expect(
        db.withTenant(tenantA, async (client) => {
          if (operation === "UPDATE") {
            await client.query("UPDATE page_versions SET title = 'Forbidden' WHERE page_id = $1", [
              pageA,
            ]);
          } else {
            await client.query("DELETE FROM page_versions WHERE page_id = $1", [pageA]);
          }
        }),
      ).rejects.toMatchObject({ code: "42501" });
    },
  );
});
