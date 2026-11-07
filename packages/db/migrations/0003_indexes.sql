ALTER TABLE "pages" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(body,''))) STORED;
ALTER TABLE "connections" ADD CONSTRAINT "connections_canonical_pages" CHECK ("connections"."page_a_id" < "connections"."page_b_id");
CREATE INDEX "brains_name_trgm_gin" ON "brains" USING gin ("name" gin_trgm_ops);
CREATE UNIQUE INDEX "ingest_sources_brain_origin_active_unique" ON "ingest_sources" USING btree ("brain_id","origin_ref") WHERE "ingest_sources"."origin_ref" IS NOT NULL AND "ingest_sources"."deleted_at" IS NULL;
CREATE INDEX "jobs_status_available_idx" ON "jobs" USING btree ("status","available_at");
CREATE INDEX "pages_search_tsv_gin" ON "pages" USING gin ("search_tsv");
CREATE INDEX "pages_entities_gin" ON "pages" USING gin ("entities");
CREATE INDEX "pages_title_trgm_gin" ON "pages" USING gin ("title" gin_trgm_ops);
CREATE INDEX "score_snapshots_brain_computed_idx" ON "score_snapshots" USING btree ("brain_id","computed_at");
