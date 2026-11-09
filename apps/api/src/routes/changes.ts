import { Elysia } from "elysia";
import { ackChange, listChanges } from "../lib/changes";
import type { RouteConfig } from "../lib/config";
import { changeAck, pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function changeRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
    .get(
      "/v1/brains/:brainId/changes",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listChanges(
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
    .patch(
      "/v1/brains/:brainId/changes/:changeId",
      ({ auth, request, params, body }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          ackChange(client, auth.tenantId, subject, params.brainId, params.changeId, body.acked),
        );
      },
      { body: changeAck },
    );
}
