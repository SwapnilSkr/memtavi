import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: url });
let currentMigration: string | null = null;

try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('memtavi_schema_migrations'))");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
    const files = await Array.fromAsync(new Bun.Glob("*.sql").scan({ cwd: directory }));
    for (const name of files.sort()) {
      currentMigration = name;
      await client.query("BEGIN");
      try {
        const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [
          name,
        ]);
        if (applied.rowCount === 0) {
          await client.query(await Bun.file(`${directory}/${name}`).text());
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release(true);
  }
} catch {
  process.stderr.write(
    `${JSON.stringify({ requestId: null, tenantId: null, route: "db:migrate", migration: currentMigration, message: "Database migration failed" })}\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
