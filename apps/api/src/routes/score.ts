import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import { scoreHistoryQuery } from "../lib/schemas";
import { getScore, getScoreHistory, getScoreSuggestions } from "../lib/score";
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
    })
    .get(
      "/v1/brains/:brainId/score/history",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          getScoreHistory(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            query.range ?? "30d",
            config.now?.() ?? new Date(),
          ),
        );
      },
      { query: scoreHistoryQuery },
    )
    .post("/v1/brains/:brainId/score/suggestions", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getScoreSuggestions(client, auth.tenantId, subject, params.brainId),
      );
    });
}
