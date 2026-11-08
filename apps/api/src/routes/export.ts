import { Elysia } from "elysia";
import type { AppConfig } from "../lib/config";
import { exportBrain } from "../lib/export";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function exportRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
    .get("/v1/brains/:brainId/export", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        exportBrain(client, auth.tenantId, subject, params.brainId),
      );
    });
}
