import type { PoolClient } from "pg";
import type { Auth } from "../middleware/auth";

export type MemoryMode = "auto" | "ask" | "off";

export async function getMemorySettings(client: PoolClient, tenantId: string, subjectId: string) {
  const result = await client.query<{ mode: MemoryMode; updatedAt: Date }>(
    `SELECT mode, updated_at AS "updatedAt" FROM memory_settings
     WHERE tenant_id = $1 AND subject_id = $2`,
    [tenantId, subjectId],
  );
  const row = result.rows[0];
  return { mode: row?.mode ?? "auto", updatedAt: row?.updatedAt.toISOString() ?? null };
}

export async function updateMemorySettings(
  client: PoolClient,
  auth: Auth,
  subjectId: string,
  mode: MemoryMode,
) {
  const result = await client.query<{ mode: MemoryMode; updatedAt: Date }>(
    `INSERT INTO memory_settings (tenant_id, subject_id, mode, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())
     ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
       mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
     RETURNING mode, updated_at AS "updatedAt"`,
    [auth.tenantId, subjectId, mode, auth.createdBy],
  );
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_type, actor_id, action, target_type, target_id, metadata)
     VALUES ($1, 'user', $2, 'memory_settings.updated', 'subject', $3, $4)`,
    [auth.tenantId, auth.createdBy, subjectId, JSON.stringify({ mode })],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Memory settings update returned no row");
  return { mode: row.mode, updatedAt: row.updatedAt.toISOString() };
}
