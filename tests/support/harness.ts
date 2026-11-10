import { createApp } from "@memtavi/api/app";
import { createFakeStore } from "@memtavi/storage/fake";
import { Pool } from "pg";
import { bootstrap } from "../../apps/api/src/bin/bootstrap";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

export const hasTestDatabase = Boolean(ownerUrl && appUrl);

export const FIXED_NOW = new Date("2026-11-07T00:00:00.000Z");
export const WEBHOOK_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

export interface RequestOptions {
  key?: string | null;
  subject?: string | null;
  method?: string;
  body?: unknown;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
}

export interface Harness {
  owner: Pool;
  request(path: string, options?: RequestOptions): Promise<Response>;
  keys: { a: string; b: string };
  tenants: { a: string; b: string };
  subjects: { a: string; b: string };
  close(): Promise<void>;
}

function requiredUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function createHarness(now: () => Date = () => FIXED_NOW): Promise<Harness> {
  const sourceUrl = requiredUrl("TEST_DATABASE_URL", ownerUrl);
  const applicationUrl = requiredUrl("TEST_APP_DATABASE_URL", appUrl);
  const owner = new Pool({ connectionString: sourceUrl });
  const application = new Pool({ connectionString: applicationUrl });
  const slugA = `contract-a-${crypto.randomUUID()}`;
  const slugB = `contract-b-${crypto.randomUUID()}`;
  const previousAppUrl = process.env.APP_DATABASE_URL;
  let fixturesAuthorized = false;
  const keys = { a: "", b: "" };
  const tenants = { a: "", b: "" };
  const subjects = { a: crypto.randomUUID(), b: crypto.randomUUID() };

  try {
    const database = await owner.query<{ name: string }>("SELECT current_database() AS name");
    const databaseName = database.rows[0]?.name ?? "";
    if (!/^memtavi_test(?:_[a-z0-9_]+)?$/.test(databaseName)) {
      throw new Error("Test fixtures require a disposable memtavi_test database");
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
    const role = appDatabase.rows[0];
    if (
      role?.name !== databaseName ||
      role.role !== "memtavi_app" ||
      role.rolsuper ||
      role.rolbypassrls
    ) {
      throw new Error("TEST_APP_DATABASE_URL must point at memtavi_test as the memtavi_app role");
    }

    process.env.APP_DATABASE_URL = applicationUrl;
    const db = await import("@memtavi/db/client");
    fixturesAuthorized = true;
    keys.a = await bootstrap(owner, "Contract A", slugA);
    keys.b = await bootstrap(owner, "Contract B", slugB);
    const rows = await owner.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[])",
      [[slugA, slugB]],
    );
    tenants.a = rows.rows.find((row) => row.slug === slugA)?.id ?? "";
    tenants.b = rows.rows.find((row) => row.slug === slugB)?.id ?? "";
    if (!tenants.a || !tenants.b) throw new Error("Bootstrap did not create both tenants");

    const app = createApp({
      ownerPool: owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now,
      webhookSecretKey: WEBHOOK_SECRET_KEY,
    });

    function buildPath(path: string, query: RequestOptions["query"]): string {
      if (!query) return path;
      const search = new URLSearchParams();
      for (const [name, value] of Object.entries(query)) search.set(name, String(value));
      return `${path}?${search.toString()}`;
    }

    return {
      owner,
      keys,
      tenants,
      subjects,
      async request(path, options = {}) {
        const headers = new Headers(options.headers);
        const key = options.key === undefined ? keys.a : options.key;
        if (key !== null) headers.set("x-api-key", key);
        const subject = options.subject === undefined ? subjects.a : options.subject;
        if (subject !== null) headers.set("x-subject-id", subject);
        if (options.body !== undefined) headers.set("content-type", "application/json");
        return app.handle(
          new Request(`http://localhost${buildPath(path, options.query)}`, {
            method: options.method ?? "GET",
            headers,
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          }),
        );
      },
      async close() {
        try {
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
        } finally {
          await Promise.all([owner.end(), application.end()]);
          if (previousAppUrl === undefined) delete process.env.APP_DATABASE_URL;
          else process.env.APP_DATABASE_URL = previousAppUrl;
        }
      },
    };
  } catch (error) {
    await Promise.all([owner.end(), application.end()]);
    throw error;
  }
}
