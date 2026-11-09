import { Elysia } from "elysia";
import { createApiKey, listApiKeys, revokeApiKey } from "../lib/api-keys";
import type { RouteConfig } from "../lib/config";
import { requireRole } from "../lib/roles";
import { apiKeyCreate, pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function apiKeyRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
    .get(
      "/v1/api-keys",
      ({ auth, request, query }) => {
        const subject = subjectId(request, false);
        requireRole(auth.role, "admin");
        return scope(config, auth, subject, (client) =>
          listApiKeys(client, auth, query.limit ?? 50, query.offset ?? 0),
        );
      },
      { query: pagination },
    )
    .post(
      "/v1/api-keys",
      async ({ auth, request, body, set }) => {
        const subject = subjectId(request, false);
        requireRole(auth.role, "admin");
        const key = await scope(config, auth, subject, (client) =>
          createApiKey(client, auth, body),
        );
        set.status = 201;
        return key;
      },
      { body: apiKeyCreate },
    )
    .delete("/v1/api-keys/:keyId", async ({ auth, request, params, set }) => {
      const subject = subjectId(request, false);
      requireRole(auth.role, "admin");
      await scope(config, auth, subject, (client) => revokeApiKey(client, auth, params.keyId));
      set.status = 204;
      return null;
    });
}
