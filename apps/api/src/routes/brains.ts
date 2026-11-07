import { Elysia } from "elysia";
import { createBrain, getBrain, listBrains } from "../lib/brains";
import type { AppConfig } from "../lib/config";
import { requireRole } from "../lib/roles";
import { brainCreate, pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function brainRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
    .get(
      "/v1/brains",
      ({ auth, request, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listBrains(client, auth.tenantId, subject, query.limit ?? 50, query.offset ?? 0),
        );
      },
      { query: pagination },
    )
    .post(
      "/v1/brains",
      async ({ auth, request, body, set }) => {
        const subject = subjectId(request);
        requireRole(auth.role, "developer");
        const brain = await scope(config, auth, subject, (client) =>
          createBrain(client, auth.tenantId, subject, body),
        );
        set.status = 201;
        return brain;
      },
      { body: brainCreate },
    )
    .get("/v1/brains/:brainId", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getBrain(client, auth.tenantId, subject, params.brainId),
      );
    });
}
