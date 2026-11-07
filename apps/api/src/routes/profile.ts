import { Elysia } from "elysia";
import type { AppConfig } from "../lib/config";
import { getProfile, updateProfile } from "../lib/profile";
import { profileUpdate } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function profileRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
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
