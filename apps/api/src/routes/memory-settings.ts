import { Elysia, t } from "elysia";
import type { RouteConfig } from "../lib/config";
import { getMemorySettings, updateMemorySettings } from "../lib/memory-settings";
import { requireRole } from "../lib/roles";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function memorySettingsRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
    .get("/v1/memory-settings", ({ auth, request }) => {
      const subject = subjectId(request);
      requireRole(auth.role, "viewer");
      return scope(config, auth, subject, (client) =>
        getMemorySettings(client, auth.tenantId, subject),
      );
    })
    .put(
      "/v1/memory-settings",
      ({ auth, request, body }) => {
        const subject = subjectId(request);
        requireRole(auth.role, "developer");
        return scope(config, auth, subject, (client) =>
          updateMemorySettings(client, auth, subject, body.mode),
        );
      },
      {
        body: t.Object({ mode: t.Union([t.Literal("auto"), t.Literal("ask"), t.Literal("off")]) }),
      },
    );
}
