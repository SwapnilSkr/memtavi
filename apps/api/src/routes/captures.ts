import { Elysia } from "elysia";
import { createCapture, deleteSource, getSource, listSources } from "../lib/captures";
import type { AppConfig } from "../lib/config";
import { captureCreate, pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { DomainError } from "../middleware/errors";
import { scope, subjectId } from "../middleware/scope";

function idempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key");
  if (value === null) return null;
  if (value.length === 0 || value.length > 200) {
    throw new DomainError("BadRequestError", 400, "Invalid Idempotency-Key");
  }
  return value;
}

export function captureRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
    .post(
      "/v1/brains/:brainId/captures",
      async ({ auth, request, params, body, set }) => {
        const subject = subjectId(request);
        const key = idempotencyKey(request);
        const result = await scope(config, auth, subject, (client) =>
          createCapture(client, auth, subject, params.brainId, body, key),
        );
        set.status = result.status;
        return result.body;
      },
      { body: captureCreate },
    )
    .get(
      "/v1/brains/:brainId/sources",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listSources(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            query.limit ?? 50,
            query.offset ?? 0,
          ),
        );
      },
      { query: pagination },
    )
    .get("/v1/brains/:brainId/sources/:sourceId", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getSource(client, auth.tenantId, subject, params.brainId, params.sourceId),
      );
    })
    .delete("/v1/brains/:brainId/sources/:sourceId", async ({ auth, request, params, set }) => {
      const subject = subjectId(request);
      const receipt = await scope(config, auth, subject, (client) =>
        deleteSource(client, auth.tenantId, subject, params.brainId, params.sourceId),
      );
      set.status = 202;
      return receipt;
    });
}
