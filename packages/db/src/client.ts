import { Pool, type PoolClient } from "pg";

const url = process.env.APP_DATABASE_URL;
if (!url) throw new Error("APP_DATABASE_URL is required");

export const pool = new Pool({ connectionString: url });

export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
  subjectId?: string,
): Promise<T> {
  if (!tenantId.trim()) throw new TypeError("tenantId is required");

  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    if (subjectId?.trim()) {
      await client.query("SELECT set_config('app.subject_id', $1, true)", [subjectId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
