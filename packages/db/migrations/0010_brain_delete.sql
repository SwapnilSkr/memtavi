ALTER TABLE "brains" DROP CONSTRAINT "brains_tenant_subject_slug_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "brains_tenant_subject_slug_unique" ON "brains" USING btree ("tenant_id","subject_id","slug") WHERE "brains"."deletion_state" = 'active';
