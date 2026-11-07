import type { PoolClient } from "pg";
import type { AppConfig } from "../lib/config";
import type { Auth } from "./auth";
import { DomainError } from "./errors";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function subjectId(request: Request): string;
export function subjectId(request: Request, required: false): string | undefined;
export function subjectId(request: Request, required = true): string | undefined {
  const value = request.headers.get("x-subject-id");
  if (value === null && !required) return undefined;
  if (!value || !uuidPattern.test(value)) {
    throw new DomainError("BadRequestError", 400, "Invalid subject id");
  }
  return value.toLowerCase();
}

export function scope<T>(
  config: AppConfig,
  auth: Auth,
  subject: string | undefined,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return config.withTenant(
    auth.tenantId,
    async (client) => {
      await client.query(
        `UPDATE api_keys SET last_used_at = now()
         WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
         AND (last_used_at IS NULL OR last_used_at <= now() - interval '60 seconds')`,
        [auth.tenantId, auth.keyId],
      );
      return fn(client);
    },
    subject,
  );
}
