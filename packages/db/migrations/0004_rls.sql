DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memberships', 'sessions', 'api_keys', 'subject_links', 'projects',
    'brains', 'ingest_sources', 'source_chunks', 'pages', 'connections',
    'routing_reviews', 'change_events', 'profiles', 'jobs', 'webhooks',
    'idempotency_keys', 'deletion_ops', 'usage_ledger', 'budget_caps', 'audit_events'
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

GRANT USAGE ON SCHEMA public TO memtavi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO memtavi_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO memtavi_app;
REVOKE UPDATE, DELETE ON page_versions FROM memtavi_app;
REVOKE ALL ON schema_migrations FROM memtavi_app;
