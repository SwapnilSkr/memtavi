import { Elysia } from "elysia";
import type { AppConfig } from "../lib/config";
import { requireRole } from "../lib/roles";
import { auth } from "../middleware/auth";
import { DomainError } from "../middleware/errors";
import { scope, subjectId } from "../middleware/scope";

export function tenantRoutes(config: AppConfig) {
  return new Elysia().use(auth(config.ownerPool)).get("/v1/tenant", ({ auth, request }) => {
    const subject = subjectId(request, false);
    requireRole(auth.role, "owner");
    return scope(config, auth, subject, async () => {
      if (!auth.tenant) throw new DomainError("NotFoundError", 404, "Not found");
      return auth.tenant;
    });
  });
}
