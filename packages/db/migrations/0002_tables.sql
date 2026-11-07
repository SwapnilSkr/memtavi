CREATE TYPE "public"."api_key_role" AS ENUM('owner', 'admin', 'developer', 'viewer');
CREATE TYPE "public"."bucket" AS ENUM('inbox', 'notes', 'ideas', 'projects');
CREATE TYPE "public"."bucket_source" AS ENUM('auto', 'user');
CREATE TYPE "public"."capture_kind" AS ENUM('note', 'url', 'file', 'transcript', 'chat_turn', 'integration');
CREATE TYPE "public"."change_action" AS ENUM('created', 'updated', 'renamed', 'merged', 'split', 'archived', 'restored', 'recovered', 'routed');
CREATE TYPE "public"."change_actor" AS ENUM('compiler', 'user');
CREATE TYPE "public"."connection_source" AS ENUM('auto', 'manual');
CREATE TYPE "public"."connection_strength" AS ENUM('weak', 'medium', 'strong');
CREATE TYPE "public"."deletion_state" AS ENUM('active', 'deleting', 'deleted');
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'delivered', 'failed', 'dead');
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'dead');
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'developer', 'viewer');
CREATE TYPE "public"."page_status" AS ENUM('active', 'stale', 'contested', 'deprecated', 'archived');
CREATE TYPE "public"."page_type" AS ENUM('source', 'topic', 'entity', 'project', 'decision', 'brief');
CREATE TYPE "public"."review_status" AS ENUM('open', 'resolved', 'dismissed');
CREATE TYPE "public"."source_status" AS ENUM('pending', 'compiling', 'completed', 'failed');
CREATE TYPE "public"."target_type" AS ENUM('brain', 'source', 'page');
CREATE TYPE "public"."usage_kind" AS ENUM('chat', 'embedding');
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"role" "api_key_role" DEFAULT 'viewer' NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);

CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "brains" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brief_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deletion_state" "deletion_state" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brains_tenant_subject_slug_unique" UNIQUE("tenant_id","subject_id","slug"),
	CONSTRAINT "brains_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "brains_tenant_subject_id_unique" UNIQUE("tenant_id","subject_id","id")
);

CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brain_id" text NOT NULL,
	"page_id" text NOT NULL,
	"for_date" date NOT NULL,
	CONSTRAINT "briefs_brain_date_unique" UNIQUE("brain_id","for_date")
);

CREATE TABLE "budget_caps" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"monthly_usd" numeric(18, 8) NOT NULL,
	"hard_stop" boolean DEFAULT true NOT NULL,
	"current_period_spend" numeric(18, 8) DEFAULT '0' NOT NULL
);

CREATE TABLE "change_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"page_id" text NOT NULL,
	"action" "change_action" NOT NULL,
	"change_summary" text NOT NULL,
	"from_version" integer,
	"to_version" integer NOT NULL,
	"ingest_source_id" text,
	"contradictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"page_a_id" text NOT NULL,
	"page_b_id" text NOT NULL,
	"similarity" double precision NOT NULL,
	"strength" "connection_strength" NOT NULL,
	"reasoning" text NOT NULL,
	"source" "connection_source" DEFAULT 'auto' NOT NULL,
	"acked_at" timestamp with time zone,
	CONSTRAINT "connections_brain_pages_unique" UNIQUE("brain_id","page_a_id","page_b_id")
);

CREATE TABLE "deletion_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" text NOT NULL,
	"state" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "idempotency_keys" (
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_tenant_id_scope_key_pk" PRIMARY KEY("tenant_id","scope","key")
);

CREATE TABLE "ingest_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"kind" "capture_kind" NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"origin_ref" text,
	"label" text,
	"bucket" "bucket" DEFAULT 'inbox' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "source_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"affected_page_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"chunk_uuids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"original_bytes" integer DEFAULT 0 NOT NULL,
	"compiled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ingest_sources_tenant_brain_id_unique" UNIQUE("tenant_id","brain_id","id")
);

CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "jobs_tenant_brain_id_unique" UNIQUE("tenant_id","brain_id","id"),
	CONSTRAINT "jobs_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key")
);

CREATE TABLE "memberships" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	CONSTRAINT "memberships_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);

CREATE TABLE "page_embeddings" (
	"page_id" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_embeddings_page_id_model_pk" PRIMARY KEY("page_id","model")
);

CREATE TABLE "page_sources" (
	"page_id" text NOT NULL,
	"ingest_source_id" text NOT NULL,
	"chunk_uuids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_sources_page_id_ingest_source_id_pk" PRIMARY KEY("page_id","ingest_source_id")
);

CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"ingest_source_id" text,
	"actor" "change_actor" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_versions_page_version_unique" UNIQUE("page_id","version")
);

CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"page_type" "page_type" DEFAULT 'topic' NOT NULL,
	"bucket" "bucket" DEFAULT 'inbox' NOT NULL,
	"bucket_source" "bucket_source" DEFAULT 'auto' NOT NULL,
	"status" "page_status" DEFAULT 'active' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"entities" text[] DEFAULT '{}'::text[] NOT NULL,
	"backlinks" text[] DEFAULT '{}'::text[] NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model" text,
	"last_compiled_at" timestamp with time zone,
	"last_referenced_at" timestamp with time zone,
	"user_edited_at" timestamp with time zone,
	"deletion_state" "deletion_state" DEFAULT 'active' NOT NULL,
	CONSTRAINT "pages_brain_slug_unique" UNIQUE("brain_id","slug"),
	CONSTRAINT "pages_tenant_brain_id_unique" UNIQUE("tenant_id","brain_id","id")
);

CREATE TABLE "profiles" (
	"brain_id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"who_they_are" text DEFAULT '' NOT NULL,
	"what_they_do" text DEFAULT '' NOT NULL,
	"focus" text DEFAULT '' NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"current_projects" text DEFAULT '' NOT NULL,
	"stuck_on" text DEFAULT '' NOT NULL,
	"vault_organization" text DEFAULT '' NOT NULL,
	"directives" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "projects_tenant_id_unique" UNIQUE("tenant_id","id")
);

CREATE TABLE "routing_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"ingest_source_id" text NOT NULL,
	"fact" jsonb NOT NULL,
	"candidate_page_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"best_gap" double precision,
	"status" "review_status" DEFAULT 'open' NOT NULL,
	"resolution" text
);

CREATE TABLE "score_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brain_id" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"freshness" double precision NOT NULL,
	"readiness" double precision NOT NULL,
	"strain" double precision NOT NULL,
	"factors" jsonb NOT NULL
);

CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);

CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"source_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"token_count" integer NOT NULL
);

CREATE TABLE "subject_links" (
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid,
	CONSTRAINT "subject_links_tenant_id_subject_id_pk" PRIMARY KEY("tenant_id","subject_id")
);

CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);

CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(18, 8) NOT NULL
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"last_error" text
);

CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret_enc" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_created_by_memberships_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brains" ADD CONSTRAINT "brains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brains" ADD CONSTRAINT "brains_tenant_id_subject_id_subject_links_tenant_id_subject_id_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."subject_links"("tenant_id","subject_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brains" ADD CONSTRAINT "brains_tenant_id_project_id_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "budget_caps" ADD CONSTRAINT "budget_caps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_tenant_id_brain_id_page_id_pages_tenant_id_brain_id_id_fk" FOREIGN KEY ("tenant_id","brain_id","page_id") REFERENCES "public"."pages"("tenant_id","brain_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_tenant_id_brain_id_ingest_source_id_ingest_sources_tenant_id_brain_id_id_fk" FOREIGN KEY ("tenant_id","brain_id","ingest_source_id") REFERENCES "public"."ingest_sources"("tenant_id","brain_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_brain_id_page_a_id_pages_tenant_id_brain_id_id_fk" FOREIGN KEY ("tenant_id","brain_id","page_a_id") REFERENCES "public"."pages"("tenant_id","brain_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_brain_id_page_b_id_pages_tenant_id_brain_id_id_fk" FOREIGN KEY ("tenant_id","brain_id","page_b_id") REFERENCES "public"."pages"("tenant_id","brain_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deletion_ops" ADD CONSTRAINT "deletion_ops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deletion_ops" ADD CONSTRAINT "deletion_ops_tenant_id_brain_id_brains_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brain_id") REFERENCES "public"."brains"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_tenant_id_subject_id_brain_id_brains_tenant_id_subject_id_id_fk" FOREIGN KEY ("tenant_id","subject_id","brain_id") REFERENCES "public"."brains"("tenant_id","subject_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_brain_id_brains_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brain_id") REFERENCES "public"."brains"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_embeddings" ADD CONSTRAINT "page_embeddings_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_sources" ADD CONSTRAINT "page_sources_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_sources" ADD CONSTRAINT "page_sources_ingest_source_id_ingest_sources_id_fk" FOREIGN KEY ("ingest_source_id") REFERENCES "public"."ingest_sources"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_ingest_source_id_ingest_sources_id_fk" FOREIGN KEY ("ingest_source_id") REFERENCES "public"."ingest_sources"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_subject_id_brain_id_brains_tenant_id_subject_id_id_fk" FOREIGN KEY ("tenant_id","subject_id","brain_id") REFERENCES "public"."brains"("tenant_id","subject_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_tenant_id_brain_id_brains_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brain_id") REFERENCES "public"."brains"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_owner_user_id_memberships_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "routing_reviews" ADD CONSTRAINT "routing_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "routing_reviews" ADD CONSTRAINT "routing_reviews_tenant_id_brain_id_ingest_source_id_ingest_sources_tenant_id_brain_id_id_fk" FOREIGN KEY ("tenant_id","brain_id","ingest_source_id") REFERENCES "public"."ingest_sources"("tenant_id","brain_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_user_id_memberships_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_tenant_id_brain_id_source_id_ingest_sources_tenant_id_brain_id_id_fk" FOREIGN KEY ("tenant_id","brain_id","source_id") REFERENCES "public"."ingest_sources"("tenant_id","brain_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subject_links" ADD CONSTRAINT "subject_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subject_links" ADD CONSTRAINT "subject_links_tenant_id_user_id_memberships_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_tenant_id_brain_id_job_id_jobs_tenant_id_brain_id_id_fk" FOREIGN KEY ("tenant_id","brain_id","job_id") REFERENCES "public"."jobs"("tenant_id","brain_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_change_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."change_events"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_subject_id_subject_links_tenant_id_subject_id_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."subject_links"("tenant_id","subject_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");
CREATE INDEX "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id");
CREATE INDEX "change_events_tenant_brain_idx" ON "change_events" USING btree ("tenant_id","brain_id");
CREATE INDEX "connections_tenant_brain_idx" ON "connections" USING btree ("tenant_id","brain_id");
CREATE INDEX "deletion_ops_tenant_brain_idx" ON "deletion_ops" USING btree ("tenant_id","brain_id");
CREATE INDEX "profiles_tenant_idx" ON "profiles" USING btree ("tenant_id");
CREATE INDEX "routing_reviews_tenant_brain_idx" ON "routing_reviews" USING btree ("tenant_id","brain_id");
CREATE INDEX "sessions_tenant_idx" ON "sessions" USING btree ("tenant_id");
CREATE INDEX "source_chunks_tenant_brain_source_idx" ON "source_chunks" USING btree ("tenant_id","brain_id","source_id");
CREATE INDEX "usage_ledger_tenant_brain_idx" ON "usage_ledger" USING btree ("tenant_id","brain_id");
CREATE INDEX "webhooks_tenant_subject_idx" ON "webhooks" USING btree ("tenant_id","subject_id");
