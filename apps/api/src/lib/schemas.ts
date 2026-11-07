import { t } from "elysia";

export const pagination = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, multipleOf: 1, default: 50 })),
  offset: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1, default: 0 })),
});

export const brainCreate = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  slug: t.Optional(t.String({ minLength: 1 })),
  description: t.Optional(t.String()),
  projectId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
  briefSettings: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const apiKeyCreate = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  role: t.Optional(
    t.Union([t.Literal("viewer"), t.Literal("developer"), t.Literal("admin"), t.Literal("owner")]),
  ),
  scopes: t.Optional(t.Array(t.String())),
  expiresAt: t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()])),
});
