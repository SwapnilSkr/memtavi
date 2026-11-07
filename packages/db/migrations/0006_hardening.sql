ALTER TABLE "pages" drop column "search_tsv";
ALTER TABLE "pages" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B') || setweight(to_tsvector('english', coalesce(body,'')), 'C')) STORED;
CREATE INDEX "pages_search_tsv_gin" ON "pages" USING gin ("search_tsv");
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_tenant_id_ingest_source_id_ingest_sources_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ingest_source_id") REFERENCES "public"."ingest_sources"("tenant_id","id") ON DELETE SET NULL ("ingest_source_id") ON UPDATE no action;
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'page_versions', 'page_sources', 'page_embeddings',
    'score_snapshots', 'briefs', 'webhook_deliveries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END;
$$;

REVOKE UPDATE, DELETE ON page_versions FROM memtavi_app;
-- p0-auth grants the narrow users and tenants access needed by authentication.
REVOKE ALL ON users, tenants FROM memtavi_app;
