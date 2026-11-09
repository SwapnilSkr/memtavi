import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import {
  deletePagePermanently,
  getIndex,
  getPageBySlug,
  listPages,
  updatePageBySlug,
} from "../lib/pages";
import { indexLimit, pageUpdate, pagination, permanentQuery, searchQuery } from "../lib/schemas";
import { searchPages } from "../lib/search";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function pageRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
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
    .patch(
      "/v1/brains/:brainId/pages/:slug",
      ({ auth, request, params, body }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          updatePageBySlug(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            params.slug,
            body,
            config.embeddings ?? null,
          ),
        );
      },
      { body: pageUpdate },
    )
    .delete(
      "/v1/brains/:brainId/pages/:slug",
      async ({ auth, request, params, query, set }) => {
        const subject = subjectId(request);
        const receipt = await scope(config, auth, subject, (client) =>
          deletePagePermanently(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            params.slug,
            query.permanent,
          ),
        );
        set.status = 202;
        return receipt;
      },
      { query: permanentQuery },
    )
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
