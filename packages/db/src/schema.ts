import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({ dataType: () => "citext" });
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const pageType = pgEnum("page_type", [
  "source",
  "topic",
  "entity",
  "project",
  "decision",
  "brief",
]);
export const bucket = pgEnum("bucket", ["inbox", "notes", "ideas", "projects"]);
export const bucketSource = pgEnum("bucket_source", ["auto", "user"]);
export const pageStatus = pgEnum("page_status", [
  "active",
  "stale",
  "contested",
  "deprecated",
  "archived",
]);
export const sourceStatus = pgEnum("source_status", [
  "pending",
  "compiling",
  "completed",
  "failed",
]);
export const captureKind = pgEnum("capture_kind", [
  "note",
  "url",
  "file",
  "transcript",
  "chat_turn",
  "integration",
]);
export const connectionStrength = pgEnum("connection_strength", ["weak", "medium", "strong"]);
export const connectionSource = pgEnum("connection_source", ["auto", "manual"]);
export const changeAction = pgEnum("change_action", [
  "created",
  "updated",
  "renamed",
  "merged",
  "split",
  "archived",
  "restored",
  "recovered",
  "routed",
]);
export const changeActor = pgEnum("change_actor", ["compiler", "user"]);
export const reviewStatus = pgEnum("review_status", ["open", "resolved", "dismissed"]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "dead",
]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "delivered", "failed", "dead"]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "developer", "viewer"]);
export const apiKeyRole = pgEnum("api_key_role", ["owner", "admin", "developer", "viewer"]);
export const targetType = pgEnum("target_type", ["brain", "source", "page"]);
export const usageKind = pgEnum("usage_kind", ["chat", "embedding"]);
export const deletionState = pgEnum("deletion_state", ["active", "deleting", "deleted"]);
export const memoryMode = pgEnum("memory_mode", ["auto", "ask", "off"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("viewer"),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("sessions_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    role: apiKeyRole("role").notNull().default("viewer"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
  ],
);

export const subjectLinks = pgTable(
  "subject_links",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull(),
    userId: uuid("user_id"),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.subjectId] }),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
  ],
);

export const memorySettings = pgTable(
  "memory_settings",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull(),
    mode: memoryMode("mode").notNull().default("auto"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.subjectId] })],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
  },
  (table) => [
    unique("projects_tenant_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
  ],
);

export const brains = pgTable(
  "brains",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull(),
    projectId: uuid("project_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    briefSettings: jsonb("brief_settings").$type<Record<string, unknown>>().notNull().default({}),
    deletionState: deletionState("deletion_state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("brains_tenant_subject_slug_unique")
      .on(table.tenantId, table.subjectId, table.slug)
      .where(sql`${table.deletionState} = 'active'`),
    unique("brains_tenant_id_unique").on(table.tenantId, table.id),
    unique("brains_tenant_subject_id_unique").on(table.tenantId, table.subjectId, table.id),
    index("brains_name_trgm_gin").using("gin", table.name.op("gin_trgm_ops")),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [subjectLinks.tenantId, subjectLinks.subjectId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const ingestSources = pgTable(
  "ingest_sources",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull(),
    brainId: text("brain_id").notNull(),
    kind: captureKind("kind").notNull(),
    content: text("content").notNull(),
    bodyRef: text("body_ref"),
    bodyBytes: integer("body_bytes").notNull().default(0),
    contentHash: text("content_hash").notNull(),
    originRef: text("origin_ref"),
    label: text("label"),
    bucket: bucket("bucket").notNull().default("inbox"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    status: sourceStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    affectedPageIds: text("affected_page_ids").array().notNull().default(sql`'{}'::text[]`),
    chunkUuids: uuid("chunk_uuids").array().notNull().default(sql`'{}'::uuid[]`),
    originalBytes: integer("original_bytes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    compiledAt: timestamp("compiled_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("ingest_sources_tenant_id_unique").on(table.tenantId, table.id),
    index("ingest_sources_brain_created_idx").on(
      table.tenantId,
      table.subjectId,
      table.brainId,
      table.createdAt.desc(),
      table.id,
    ),
    unique("ingest_sources_tenant_brain_id_unique").on(table.tenantId, table.brainId, table.id),
    uniqueIndex("ingest_sources_brain_origin_active_unique")
      .on(table.brainId, table.originRef)
      .where(sql`${table.originRef} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    foreignKey({
      columns: [table.tenantId, table.subjectId, table.brainId],
      foreignColumns: [brains.tenantId, brains.subjectId, brains.id],
    }).onDelete("cascade"),
  ],
);

export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    brainId: text("brain_id").notNull(),
    sourceId: text("source_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text"),
    bodyRef: text("body_ref"),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    tokenCount: integer("token_count").notNull(),
  },
  (table) => [
    index("source_chunks_tenant_brain_source_idx").on(
      table.tenantId,
      table.brainId,
      table.sourceId,
    ),
    foreignKey({
      columns: [table.tenantId, table.brainId, table.sourceId],
      foreignColumns: [ingestSources.tenantId, ingestSources.brainId, ingestSources.id],
    }).onDelete("cascade"),
  ],
);

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull(),
    brainId: text("brain_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    body: text("body").notNull().default(""),
    pageType: pageType("page_type").notNull().default("topic"),
    bucket: bucket("bucket").notNull().default("inbox"),
    bucketSource: bucketSource("bucket_source").notNull().default("auto"),
    status: pageStatus("status").notNull().default("active"),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    version: integer("version").notNull().default(1),
    entities: text("entities").array().notNull().default(sql`'{}'::text[]`),
    backlinks: text("backlinks").array().notNull().default(sql`'{}'::text[]`),
    contentHash: text("content_hash").notNull(),
    embeddingModel: text("embedding_model"),
    lastCompiledAt: timestamp("last_compiled_at", { withTimezone: true }),
    lastReferencedAt: timestamp("last_referenced_at", { withTimezone: true }),
    userEditedAt: timestamp("user_edited_at", { withTimezone: true }),
    deletionState: deletionState("deletion_state").notNull().default("active"),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B') || setweight(to_tsvector('english', coalesce(body,'')), 'C')`,
    ),
  },
  (table) => [
    uniqueIndex("pages_brain_slug_unique")
      .on(table.brainId, table.slug)
      .where(sql`${table.deletionState} = 'active'`),
    unique("pages_tenant_id_unique").on(table.tenantId, table.id),
    unique("pages_tenant_brain_id_unique").on(table.tenantId, table.brainId, table.id),
    index("pages_search_tsv_gin").using("gin", table.searchTsv),
    index("pages_entities_gin").using("gin", table.entities),
    index("pages_title_trgm_gin").using("gin", table.title.op("gin_trgm_ops")),
    foreignKey({
      columns: [table.tenantId, table.subjectId, table.brainId],
      foreignColumns: [brains.tenantId, brains.subjectId, brains.id],
    }).onDelete("cascade"),
  ],
);

export const pageVersions = pgTable(
  "page_versions",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: text("page_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    body: text("body").notNull(),
    ingestSourceId: text("ingest_source_id"),
    actor: changeActor("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("page_versions_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.pageId],
      foreignColumns: [pages.tenantId, pages.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.ingestSourceId],
      foreignColumns: [ingestSources.tenantId, ingestSources.id],
    }).onDelete("set null"),
    unique("page_versions_page_version_unique").on(table.pageId, table.version),
  ],
);

export const pageSources = pgTable(
  "page_sources",
  {
    tenantId: uuid("tenant_id").notNull(),
    pageId: text("page_id").notNull(),
    ingestSourceId: text("ingest_source_id").notNull(),
    chunkUuids: uuid("chunk_uuids").array().notNull().default(sql`'{}'::uuid[]`),
    attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("page_sources_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.pageId],
      foreignColumns: [pages.tenantId, pages.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.ingestSourceId],
      foreignColumns: [ingestSources.tenantId, ingestSources.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.pageId, table.ingestSourceId] }),
  ],
);

export const pageEmbeddings = pgTable(
  "page_embeddings",
  {
    tenantId: uuid("tenant_id").notNull(),
    pageId: text("page_id").notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("page_embeddings_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.pageId],
      foreignColumns: [pages.tenantId, pages.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.pageId, table.model] }),
  ],
);

export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    brainId: text("brain_id").notNull(),
    pageAId: text("page_a_id").notNull(),
    pageBId: text("page_b_id").notNull(),
    similarity: doublePrecision("similarity").notNull(),
    strength: connectionStrength("strength").notNull(),
    reasoning: text("reasoning").notNull(),
    source: connectionSource("source").notNull().default("auto"),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
  },
  (table) => [
    index("connections_tenant_brain_idx").on(table.tenantId, table.brainId),
    unique("connections_brain_pages_unique").on(table.brainId, table.pageAId, table.pageBId),
    check("connections_canonical_pages", sql`${table.pageAId} < ${table.pageBId}`),
    foreignKey({
      columns: [table.tenantId, table.brainId, table.pageAId],
      foreignColumns: [pages.tenantId, pages.brainId, pages.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.brainId, table.pageBId],
      foreignColumns: [pages.tenantId, pages.brainId, pages.id],
    }).onDelete("cascade"),
  ],
);

export const routingReviews = pgTable(
  "routing_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    brainId: text("brain_id").notNull(),
    ingestSourceId: text("ingest_source_id").notNull(),
    fact: jsonb("fact").$type<Record<string, unknown>>().notNull(),
    candidatePageIds: text("candidate_page_ids").array().notNull().default(sql`'{}'::text[]`),
    bestGap: doublePrecision("best_gap"),
    status: reviewStatus("status").notNull().default("open"),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("routing_reviews_tenant_brain_idx").on(table.tenantId, table.brainId),
    index("routing_reviews_list_idx").on(
      table.tenantId,
      table.brainId,
      table.status,
      table.createdAt.desc(),
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.brainId, table.ingestSourceId],
      foreignColumns: [ingestSources.tenantId, ingestSources.brainId, ingestSources.id],
    }).onDelete("cascade"),
  ],
);

export const changeEvents = pgTable(
  "change_events",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    brainId: text("brain_id").notNull(),
    pageId: text("page_id").notNull(),
    action: changeAction("action").notNull(),
    changeSummary: text("change_summary").notNull(),
    fromVersion: integer("from_version"),
    toVersion: integer("to_version").notNull(),
    ingestSourceId: text("ingest_source_id"),
    contradictions: jsonb("contradictions").$type<unknown[]>().notNull().default([]),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("change_events_tenant_id_unique").on(table.tenantId, table.id),
    index("change_events_tenant_brain_idx").on(table.tenantId, table.brainId),
    foreignKey({
      columns: [table.tenantId, table.brainId, table.pageId],
      foreignColumns: [pages.tenantId, pages.brainId, pages.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.brainId, table.ingestSourceId],
      foreignColumns: [ingestSources.tenantId, ingestSources.brainId, ingestSources.id],
    }).onDelete("cascade"),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    brainId: text("brain_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    whoTheyAre: text("who_they_are").notNull().default(""),
    whatTheyDo: text("what_they_do").notNull().default(""),
    focus: text("focus").notNull().default(""),
    goals: text("goals").notNull().default(""),
    currentProjects: text("current_projects").notNull().default(""),
    stuckOn: text("stuck_on").notNull().default(""),
    vaultOrganization: text("vault_organization").notNull().default(""),
    directives: jsonb("directives").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("profiles_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.brainId],
      foreignColumns: [brains.tenantId, brains.id],
    }).onDelete("cascade"),
  ],
);

export const scoreSnapshots = pgTable(
  "score_snapshots",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    brainId: text("brain_id").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    freshness: doublePrecision("freshness").notNull(),
    readiness: doublePrecision("readiness").notNull(),
    strain: doublePrecision("strain").notNull(),
    factors: jsonb("factors").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index("score_snapshots_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.brainId],
      foreignColumns: [brains.tenantId, brains.id],
    }).onDelete("cascade"),
    index("score_snapshots_brain_computed_idx").on(table.brainId, table.computedAt),
  ],
);

export const briefs = pgTable(
  "briefs",
  {
    tenantId: uuid("tenant_id").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    brainId: text("brain_id").notNull(),
    pageId: text("page_id").notNull(),
    forDate: date("for_date").notNull(),
  },
  (table) => [
    index("briefs_tenant_idx").on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.brainId],
      foreignColumns: [brains.tenantId, brains.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.pageId],
      foreignColumns: [pages.tenantId, pages.id],
    }).onDelete("cascade"),
    unique("briefs_brain_date_unique").on(table.brainId, table.forDate),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    brainId: text("brain_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    unique("jobs_tenant_brain_id_unique").on(table.tenantId, table.brainId, table.id),
    unique("jobs_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey),
    index("jobs_status_available_idx").on(table.status, table.availableAt),
    foreignKey({
      columns: [table.tenantId, table.brainId],
      foreignColumns: [brains.tenantId, brains.id],
    }).onDelete("cascade"),
  ],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull(),
    url: text("url").notNull(),
    events: text("events").array().notNull(),
    secretEnc: text("secret_enc").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    unique("webhooks_tenant_id_unique").on(table.tenantId, table.id),
    index("webhooks_tenant_subject_idx").on(table.tenantId, table.subjectId),
    foreignKey({
      columns: [table.tenantId, table.subjectId],
      foreignColumns: [subjectLinks.tenantId, subjectLinks.subjectId],
    }).onDelete("cascade"),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    brainId: text("brain_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    kind: text("kind").notNull(),
    action: text("action"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    unique("webhook_events_tenant_id_unique").on(table.tenantId, table.id),
    index("webhook_events_tenant_brain_idx").on(table.tenantId, table.brainId),
    check("webhook_events_kind", sql`${table.kind} IN ('change', 'connection', 'import')`),
    check(
      "webhook_events_action",
      sql`(${table.kind} = 'change' AND ${table.action} IS NOT NULL) OR (${table.kind} <> 'change' AND ${table.action} IS NULL)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectId, table.brainId],
      foreignColumns: [brains.tenantId, brains.subjectId, brains.id],
    }).onDelete("cascade"),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    webhookId: uuid("webhook_id").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
  },
  (table) => [
    index("webhook_deliveries_tenant_idx").on(table.tenantId),
    unique("webhook_deliveries_tenant_webhook_event_unique").on(
      table.tenantId,
      table.webhookId,
      table.eventId,
    ),
    foreignKey({
      columns: [table.tenantId, table.webhookId],
      foreignColumns: [webhooks.tenantId, webhooks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.eventId],
      foreignColumns: [webhookEvents.tenantId, webhookEvents.id],
    }).onDelete("cascade"),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").$type<unknown>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.scope, table.key] })],
);

export const deletionOps = pgTable(
  "deletion_ops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    brainId: text("brain_id").notNull(),
    targetType: targetType("target_type").notNull(),
    targetId: text("target_id").notNull(),
    state: text("state").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("deletion_ops_tenant_brain_idx").on(table.tenantId, table.brainId),
    foreignKey({
      columns: [table.tenantId, table.brainId],
      foreignColumns: [brains.tenantId, brains.id],
    }).onDelete("cascade"),
  ],
);

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    brainId: text("brain_id").notNull(),
    jobId: uuid("job_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    kind: usageKind("kind").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_ledger_tenant_brain_idx").on(table.tenantId, table.brainId),
    index("usage_ledger_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
    foreignKey({
      columns: [table.tenantId, table.brainId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.brainId, jobs.id],
    }).onDelete("cascade"),
  ],
);

export const budgetCaps = pgTable("budget_caps", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  monthlyUsd: numeric("monthly_usd", { precision: 18, scale: 8 }).notNull(),
  hardStop: boolean("hard_stop").notNull().default(true),
  currentPeriodSpend: numeric("current_period_spend", { precision: 18, scale: 8 })
    .notNull()
    .default("0"),
  maxStorageBytes: bigint("max_storage_bytes", { mode: "number" }).notNull().default(5368709120),
  maxPages: integer("max_pages").notNull().default(1000),
  maxSources: integer("max_sources").notNull().default(5000),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("audit_events_tenant_idx").on(table.tenantId)],
);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type SubjectLink = typeof subjectLinks.$inferSelect;
export type MemorySetting = typeof memorySettings.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Brain = typeof brains.$inferSelect;
export type IngestSource = typeof ingestSources.$inferSelect;
export type SourceChunk = typeof sourceChunks.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type PageVersion = typeof pageVersions.$inferSelect;
export type PageSource = typeof pageSources.$inferSelect;
export type PageEmbedding = typeof pageEmbeddings.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type RoutingReview = typeof routingReviews.$inferSelect;
export type ChangeEvent = typeof changeEvents.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type ScoreSnapshot = typeof scoreSnapshots.$inferSelect;
export type Brief = typeof briefs.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type DeletionOp = typeof deletionOps.$inferSelect;
export type UsageLedger = typeof usageLedger.$inferSelect;
export type BudgetCap = typeof budgetCaps.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
