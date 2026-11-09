import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import { getScore } from "../lib/score";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function scoreRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
    .get("/v1/brains/:brainId/score", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getScore(client, auth.tenantId, subject, params.brainId),
      );
    });
}
