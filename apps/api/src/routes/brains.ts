import { Elysia } from "elysia";
import { createBrain, getBrain, listBrains, updateBrain } from "../lib/brains";
import type { RouteConfig } from "../lib/config";
import { requireRole } from "../lib/roles";
import { brainCreate, brainUpdate, pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function brainRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
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
    })
    .patch(
      "/v1/brains/:brainId",
      ({ auth, request, params, body }) => {
        const subject = subjectId(request);
        requireRole(auth.role, "developer");
        return scope(config, auth, subject, (client) =>
          updateBrain(client, auth.tenantId, subject, params.brainId, body),
        );
      },
      { body: brainUpdate },
    );
}
