import { Elysia } from "elysia";
import type { AppConfig } from "../lib/config";
import { ackConnection, getGraph, listConnections } from "../lib/graph";
import { connectionAck, pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function graphRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
    .get("/v1/brains/:brainId/graph", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getGraph(client, auth.tenantId, subject, params.brainId),
      );
    })
    .get(
      "/v1/brains/:brainId/connections",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listConnections(
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
      "/v1/brains/:brainId/connections/:connectionId",
      ({ auth, request, params, body }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          ackConnection(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            params.connectionId,
            body.acked,
          ),
        );
      },
      { body: connectionAck },
    );
}
