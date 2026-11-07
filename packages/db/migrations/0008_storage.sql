CREATE TYPE "public"."memory_mode" AS ENUM('auto', 'ask', 'off');--> statement-breakpoint
CREATE TABLE "memory_settings" (
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"mode" "memory_mode" DEFAULT 'auto' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_settings_tenant_id_subject_id_pk" PRIMARY KEY("tenant_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "source_chunks" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_caps" ADD COLUMN "max_storage_bytes" bigint DEFAULT 5368709120 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_caps" ADD COLUMN "max_pages" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_caps" ADD COLUMN "max_sources" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD COLUMN "body_ref" text;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD COLUMN "body_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD COLUMN "body_ref" text;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "memory_settings"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memory_settings" TO memtavi_app;
