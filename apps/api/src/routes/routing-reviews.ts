import { Elysia, t } from "elysia";
import type { RouteConfig } from "../lib/config";
import { listRoutingReviews, settleRoutingReview } from "../lib/routing-reviews";
import { pagination } from "../lib/schemas";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

const reviewParams = t.Object({ brainId: t.String(), reviewId: t.String({ format: "uuid" }) });
const note = t.Optional(t.String({ maxLength: 2000 }));

export function routingReviewRoutes(config: RouteConfig) {
  return new Elysia()
    .use(auth(config))
    .get(
      "/v1/brains/:brainId/routing-reviews",
      ({ auth, request, params, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listRoutingReviews(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            query.status ?? "open",
            query.limit ?? 50,
            query.offset ?? 0,
          ),
        );
      },
      {
        query: t.Object({
          ...pagination.properties,
          status: t.Optional(
            t.Union([t.Literal("open"), t.Literal("resolved"), t.Literal("dismissed")]),
          ),
        }),
      },
    )
    .post(
      "/v1/brains/:brainId/routing-reviews/:reviewId/resolve",
      async ({ auth, request, params, body, set }) => {
        const subject = subjectId(request);
        const review = await scope(config, auth, subject, (client) =>
          settleRoutingReview(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            params.reviewId,
            auth.role,
            body,
          ),
        );
        set.status = 202;
        return review;
      },
      {
        params: reviewParams,
        body: t.Union([
          t.Object(
            { pageId: t.String({ minLength: 1 }), newPage: t.Optional(t.Never()), note },
            { additionalProperties: false },
          ),
          t.Object(
            { newPage: t.Literal(true), pageId: t.Optional(t.Never()), note },
            { additionalProperties: false },
          ),
        ]),
      },
    )
    .post(
      "/v1/brains/:brainId/routing-reviews/:reviewId/dismiss",
      ({ auth, request, params, body }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          settleRoutingReview(
            client,
            auth.tenantId,
            subject,
            params.brainId,
            params.reviewId,
            auth.role,
            null,
            body?.note,
          ),
        );
      },
      {
        params: reviewParams,
        body: t.Optional(t.Object({ note }, { additionalProperties: false })),
      },
    );
}
