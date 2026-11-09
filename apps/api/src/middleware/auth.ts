import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import { hashKey } from "../lib/keys";
import type { Role } from "../lib/roles";
import { DomainError, RateLimitError } from "./errors";

export interface Auth {
  tenantId: string;
  role: Role;
  keyId: string;
  createdBy: string;
  tenant: { id: string; name: string; slug: string; plan: string } | null;
}

export function auth(config: RouteConfig) {
  return new Elysia({ name: "auth" }).resolve({ as: "scoped" }, async ({ request, set }) => {
    const key = request.headers.get("x-api-key");
    if (!key) throw new DomainError("UnauthorizedError", 401, "Missing API key");
    const result = await config.ownerPool.query<Auth>(
      `SELECT k.tenant_id AS "tenantId", k.role, k.id AS "keyId", k.created_by AS "createdBy",
       CASE WHEN k.role = 'owner' THEN
         (SELECT json_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'plan', t.plan)
          FROM tenants t WHERE t.id = k.tenant_id) END AS tenant
       FROM api_keys k WHERE k.key_hash = $1 AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > now())`,
      [hashKey(key)],
    );
    const identity = result.rows[0];
    if (!identity) throw new DomainError("UnauthorizedError", 401, "Invalid API key");
    const limit = config.rateLimiter.check(identity.keyId);
    if (!limit.allowed) throw new RateLimitError(limit.retryAfterSeconds);
    set.headers["RateLimit-Limit"] = String(limit.limit);
    set.headers["RateLimit-Remaining"] = String(limit.remaining);
    set.headers["RateLimit-Reset"] = String(Math.floor(limit.resetAt / 1000));
    return { auth: identity };
  });
}
