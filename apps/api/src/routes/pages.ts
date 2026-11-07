import { Elysia } from "elysia";
import type { AppConfig } from "../lib/config";
import { getIndex, getPageBySlug, listPages } from "../lib/pages";
import { indexLimit, pagination, searchQuery } from "../lib/schemas";
import { searchPages } from "../lib/search";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function pageRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
    .get(
      "/v1/brains/:brainId/pages",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listPages(
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
    .get("/v1/brains/:brainId/pages/:slug", ({ auth, request, params }) => {
      const subject = subjectId(request);
      return scope(config, auth, subject, (client) =>
        getPageBySlug(client, auth.tenantId, subject, params.brainId, params.slug),
      );
    })
    .get(
      "/v1/brains/:brainId/index",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          getIndex(client, auth.tenantId, subject, params.brainId, query.limit ?? 40, 0),
        );
      },
      { query: indexLimit },
    )
    .get(
      "/v1/brains/:brainId/search",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          searchPages(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            { q: query.q, limit: query.limit ?? 50, minSimilarity: query.minSimilarity ?? null },
            config.embeddings ?? null,
          ),
        );
      },
      { query: searchQuery },
    );
}
