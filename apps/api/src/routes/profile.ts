import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import { getProfile, updateProfile } from "../lib/profile";
import { profileUpdate } from "../lib/schemas";
import { auth } from "../middleware/auth";
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
