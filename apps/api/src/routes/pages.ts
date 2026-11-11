import { Elysia } from "elysia";
import type { RouteConfig } from "../lib/config";
import {
  deletePagePermanently,
  getIndex,
  getPageBySlug,
  listPages,
  updatePageBySlug,
} from "../lib/pages";
import { resolvePage } from "../lib/resolve";
import { requireRole } from "../lib/roles";
import {
  diffQuery,
  indexQuery,
  pageListQuery,
  pageResolve,
  pageUpdate,
  pagination,
  permanentQuery,
  searchQuery,
} from "../lib/schemas";
import { searchPages } from "../lib/search";
import { diffPageVersions, getPageVersion, listPageVersions } from "../lib/versions";
import { auth } from "../middleware/auth";
import { DomainError } from "../middleware/errors";
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
            query.status ?? null,
            query.limit ?? 50,
            query.offset ?? 0,
          ),
        );
      },
      { query: pageListQuery },
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
    .post(
      "/v1/brains/:brainId/pages/:slug/resolve",
      ({ auth, request, params, body }) => {
        const subject = subjectId(request);
        requireRole(auth.role, "developer");
        return scope(config, auth, subject, (client) =>
          resolvePage(
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
      { body: pageResolve },
    )
    .get(
      "/v1/brains/:brainId/pages/:slug/versions",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listPageVersions(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            params.slug,
            query.limit ?? 50,
            query.offset ?? 0,
          ),
        );
      },
      { query: pagination },
    )
    .get("/v1/brains/:brainId/pages/:slug/versions/:version", ({ auth, request, params }) => {
      const subject = subjectId(request);
      const version = Number(params.version);
      if (!Number.isInteger(version) || version < 1) {
        throw new DomainError("BadRequestError", 400, "Invalid request");
      }
      return scope(config, auth, subject, (client) =>
        getPageVersion(client, auth.tenantId, subject, params.brainId, params.slug, version),
      );
    })
    .get(
      "/v1/brains/:brainId/pages/:slug/diff",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          diffPageVersions(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            params.slug,
            query.from,
            query.to,
          ),
        );
      },
      { query: diffQuery },
    )
    .get(
      "/v1/brains/:brainId/index",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          getIndex(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            query.status ?? null,
            query.limit ?? 40,
            query.offset ?? 0,
          ),
        );
      },
      { query: indexQuery },
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
