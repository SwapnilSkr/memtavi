import { t } from "elysia";

export const pagination = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, multipleOf: 1, default: 50 })),
  offset: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1, default: 0 })),
});

export const indexLimit = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, multipleOf: 1, default: 40 })),
});

export const searchQuery = t.Object({
  q: t.String({ minLength: 1 }),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, multipleOf: 1, default: 50 })),
  minSimilarity: t.Optional(t.Numeric({ minimum: 0, maximum: 1 })),
});

export const brainCreate = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  slug: t.Optional(t.String({ minLength: 1 })),
  description: t.Optional(t.String()),
  projectId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
  briefSettings: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const captureCreate = t.Object({
  kind: t.Union([
    t.Literal("note"),
    t.Literal("url"),
    t.Literal("file"),
    t.Literal("transcript"),
    t.Literal("chat_turn"),
    t.Literal("integration"),
  ]),
  content: t.Optional(t.Union([t.String(), t.Null()])),
  fetchUrl: t.Optional(t.Union([t.String(), t.Null()])),
  originRef: t.Optional(t.Union([t.String(), t.Null()])),
  label: t.Optional(t.Union([t.String(), t.Null()])),
  bucket: t.Optional(
    t.Union([t.Literal("inbox"), t.Literal("notes"), t.Literal("ideas"), t.Literal("projects")]),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const changeAck = t.Object({
  acked: t.Boolean(),
});

export const connectionAck = t.Object({
  acked: t.Boolean(),
});

export const pageUpdate = t.Object({
  title: t.Optional(t.String()),
  summary: t.Optional(t.String()),
  body: t.Optional(t.String()),
  bucket: t.Optional(
    t.Union([t.Literal("inbox"), t.Literal("notes"), t.Literal("ideas"), t.Literal("projects")]),
  ),
  pinned: t.Optional(t.Boolean()),
  archived: t.Optional(t.Boolean()),
  status: t.Optional(
    t.Union([
      t.Literal("active"),
      t.Literal("stale"),
      t.Literal("contested"),
      t.Literal("deprecated"),
      t.Literal("archived"),
    ]),
  ),
  version: t.Optional(t.Integer({ minimum: 1 })),
});

export const apiKeyCreate = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  role: t.Optional(
    t.Union([t.Literal("viewer"), t.Literal("developer"), t.Literal("admin"), t.Literal("owner")]),
  ),
  scopes: t.Optional(t.Array(t.String())),
  expiresAt: t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()])),
});
