import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import { exportBrain } from "../lib/export";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function exportRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
    .get("/v1/brains/:brainId/export", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        exportBrain(client, auth.tenantId, subject, params.brainId),
      );
    });
}
