ALTER TABLE "pages" DROP CONSTRAINT "pages_brain_slug_unique";--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT "briefs_brain_id_brains_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT "briefs_page_id_pages_id_fk";--> statement-breakpoint
ALTER TABLE "page_embeddings" DROP CONSTRAINT "page_embeddings_page_id_pages_id_fk";--> statement-breakpoint
ALTER TABLE "page_sources" DROP CONSTRAINT "page_sources_page_id_pages_id_fk";--> statement-breakpoint
ALTER TABLE "page_sources" DROP CONSTRAINT "page_sources_ingest_source_id_ingest_sources_id_fk";--> statement-breakpoint
ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_page_id_pages_id_fk";--> statement-breakpoint
ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_ingest_source_id_ingest_sources_id_fk";--> statement-breakpoint
ALTER TABLE "score_snapshots" DROP CONSTRAINT "score_snapshots_brain_id_brains_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_event_id_change_events_id_fk";--> statement-breakpoint
ALTER TABLE "ingest_sources" ALTER COLUMN "affected_page_ids" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ingest_sources" ALTER COLUMN "affected_page_ids" SET DATA TYPE text[] USING "affected_page_ids"::text[];--> statement-breakpoint
ALTER TABLE "ingest_sources" ALTER COLUMN "affected_page_ids" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "routing_reviews" ALTER COLUMN "candidate_page_ids" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "routing_reviews" ALTER COLUMN "candidate_page_ids" SET DATA TYPE text[] USING "candidate_page_ids"::text[];--> statement-breakpoint
ALTER TABLE "routing_reviews" ALTER COLUMN "candidate_page_ids" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "briefs" AS child SET "tenant_id" = parent."tenant_id" FROM "brains" AS parent WHERE child."brain_id" = parent."id";--> statement-breakpoint
ALTER TABLE "briefs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "page_embeddings" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "page_embeddings" AS child SET "tenant_id" = parent."tenant_id" FROM "pages" AS parent WHERE child."page_id" = parent."id";--> statement-breakpoint
ALTER TABLE "page_embeddings" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "page_sources" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "page_sources" AS child SET "tenant_id" = parent."tenant_id" FROM "pages" AS parent WHERE child."page_id" = parent."id";--> statement-breakpoint
ALTER TABLE "page_sources" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "page_versions" AS child SET "tenant_id" = parent."tenant_id" FROM "pages" AS parent WHERE child."page_id" = parent."id";--> statement-breakpoint
ALTER TABLE "page_versions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "score_snapshots" AS child SET "tenant_id" = parent."tenant_id" FROM "brains" AS parent WHERE child."brain_id" = parent."id";--> statement-breakpoint
ALTER TABLE "score_snapshots" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "webhook_deliveries" AS child SET "tenant_id" = parent."tenant_id" FROM "webhooks" AS parent WHERE child."webhook_id" = parent."id";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_tenant_id_brain_id_brains_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brain_id") REFERENCES "public"."brains"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_tenant_id_page_id_pages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_embeddings" ADD CONSTRAINT "page_embeddings_tenant_id_page_id_pages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_sources" ADD CONSTRAINT "page_sources_tenant_id_page_id_pages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_sources" ADD CONSTRAINT "page_sources_tenant_id_ingest_source_id_ingest_sources_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ingest_source_id") REFERENCES "public"."ingest_sources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_tenant_id_page_id_pages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_tenant_id_brain_id_brains_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brain_id") REFERENCES "public"."brains"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_webhook_id_webhooks_tenant_id_id_fk" FOREIGN KEY ("tenant_id","webhook_id") REFERENCES "public"."webhooks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_event_id_change_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."change_events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefs_tenant_idx" ON "briefs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "page_embeddings_tenant_idx" ON "page_embeddings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "page_sources_tenant_idx" ON "page_sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "page_versions_tenant_idx" ON "page_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_brain_slug_unique" ON "pages" USING btree ("brain_id","slug") WHERE "pages"."deletion_state" = 'active';--> statement-breakpoint
CREATE INDEX "score_snapshots_tenant_idx" ON "score_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_tenant_idx" ON "webhook_deliveries" USING btree ("tenant_id");
