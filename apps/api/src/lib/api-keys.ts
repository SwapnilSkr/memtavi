import type { Static } from "elysia";
import type { PoolClient } from "pg";
import type { Auth } from "../middleware/auth";
import { DomainError } from "../middleware/errors";
import { uuidPattern } from "../middleware/scope";
import { issueKey } from "./keys";
import { requireRole } from "./roles";
import type { apiKeyCreate } from "./schemas";

const columns = `id, name, prefix, role, scopes, last_used_at AS "lastUsedAt",
  expires_at AS "expiresAt", revoked_at AS "revokedAt"`;

export async function auditKey(client: PoolClient, auth: Auth, action: string, targetId: string) {
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_type, actor_id, action, target_type, target_id)
     VALUES ($1, 'api_key', $2, $3, 'api_key', $4)`,
    [auth.tenantId, auth.keyId, action, targetId],
  );
}

export async function createApiKey(
  client: PoolClient,
  auth: Auth,
  body: Static<typeof apiKeyCreate>,
) {
  const role = body.role ?? "viewer";
  requireRole(auth.role, role);
  const issued = issueKey();
  const result = await client.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, created_by, name, prefix, key_hash, role, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${columns}`,
    [
      auth.tenantId,
      auth.createdBy,
      body.name,
      issued.prefix,
      issued.hash,
      role,
      body.scopes ?? [],
      body.expiresAt ?? null,
    ],
  );
  const key = result.rows[0];
  if (!key) throw new Error("Key insert returned no row");
  await auditKey(client, auth, "api_key.created", key.id);
  return { ...key, key: issued.key };
}

export async function listApiKeys(client: PoolClient, auth: Auth, limit: number, offset: number) {
  const total = await client.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM api_keys WHERE tenant_id = $1",
    [auth.tenantId],
  );
  const items = await client.query(
    `SELECT ${columns} FROM api_keys WHERE tenant_id = $1 ORDER BY id LIMIT $2 OFFSET $3`,
    [auth.tenantId, limit, offset],
  );
  await auditKey(client, auth, "api_key.listed", auth.tenantId);
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function revokeApiKey(client: PoolClient, auth: Auth, keyId: string) {
  if (!uuidPattern.test(keyId)) throw new DomainError("NotFoundError", 404, "Not found");
  const result = await client.query(
    `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
     WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [auth.tenantId, keyId],
  );
  if (!result.rowCount) throw new DomainError("NotFoundError", 404, "Not found");
  await auditKey(client, auth, "api_key.revoked", keyId);
}
