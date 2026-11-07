import { parseArgs } from "node:util";
import { Pool } from "pg";
import { issueKey } from "../lib/keys";

export async function bootstrap(pool: Pool, name: string, slug: string): Promise<string> {
  if (!name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("A name and lowercase hyphenated slug are required");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenants = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
      [name, slug],
    );
    const tenant = tenants.rows[0];
    if (!tenant) throw new Error("Tenant insert returned no row");
    const keys = await client.query("SELECT id FROM api_keys WHERE tenant_id = $1 LIMIT 1", [
      tenant.id,
    ]);
    if (keys.rowCount) throw new Error("Tenant already has an API key");
    const userId = crypto.randomUUID();
    await client.query("INSERT INTO users (id, email, name) VALUES ($1, $2, $3)", [
      userId,
      `${userId}@bootstrap.invalid`,
      name,
    ]);
    await client.query(
      "INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
      [tenant.id, userId],
    );
    const issued = issueKey();
    const result = await client.query<{ id: string }>(
      `INSERT INTO api_keys (tenant_id, created_by, name, prefix, key_hash, role)
       VALUES ($1, $2, 'Bootstrap owner', $3, $4, 'owner') RETURNING id`,
      [tenant.id, userId, issued.prefix, issued.hash],
    );
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_type, actor_id, action, target_type, target_id)
       VALUES ($1, 'bootstrap', $2, 'api_key.created', 'api_key', $3)`,
      [tenant.id, userId, result.rows[0]?.id],
    );
    await client.query("COMMIT");
    return issued.key;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  let pool: Pool | undefined;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { name: { type: "string" }, slug: { type: "string" } },
    });
    if (!process.env.DATABASE_URL || !values.name || !values.slug) {
      throw new Error("DATABASE_URL, --name and --slug are required");
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    process.stdout.write(`${await bootstrap(pool, values.name, values.slug)}\n`);
  } catch {
    process.stderr.write("Bootstrap failed\n");
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
