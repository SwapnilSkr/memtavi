import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import { getProfile, getProfileSuggestions, updateProfile } from "../lib/profile";
import { requireRole } from "../lib/roles";
import { profileUpdate } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { DomainError } from "../middleware/errors";
import { scope, subjectId } from "../middleware/scope";

export function profileRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
    .get("/v1/brains/:brainId/profile", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getProfile(client, auth.tenantId, subject, params.brainId),
      );
    })
    .post("/v1/brains/:brainId/profile/suggestions", async ({ auth, request, params, set }) => {
      const subject = subjectId(request);
      requireRole(auth.role, "developer");
      const result = await scope(config, auth, subject, (client) =>
        getProfileSuggestions(client, auth.tenantId, subject, params.brainId, config),
      );
      if (result instanceof DomainError) {
        if (result.status === 429) set.headers["Retry-After"] = "60";
        throw result;
      }
      return result;
    })
    .patch(
      "/v1/brains/:brainId/profile",
      ({ auth, request, params, body }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          updateProfile(client, auth.tenantId, subject, params.brainId, body),
        );
      },
      { body: profileUpdate },
    );
}
