import { Elysia } from "elysia";
import type { AppConfig } from "../lib/config";
import { getScore } from "../lib/score";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function scoreRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
    .get("/v1/brains/:brainId/score", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getScore(client, auth.tenantId, subject, params.brainId),
      );
    });
}
