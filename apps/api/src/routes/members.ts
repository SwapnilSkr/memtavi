import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import { listMembers } from "../lib/members";
import { requireRole } from "../lib/roles";
import { pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function memberRoutes(config: RouteConfig) {
  return new Elysia().use(auth(config)).get(
    "/v1/members",
    ({ auth, request, query }) => {
      const subject = subjectId(request, false);
      requireRole(auth.role, "admin");
      return scope(config, auth, subject, (client) =>
        listMembers(client, auth, query.limit ?? 50, query.offset ?? 0),
      );
    },
    { query: pagination },
  );
}
