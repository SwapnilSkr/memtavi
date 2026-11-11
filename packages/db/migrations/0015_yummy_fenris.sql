ALTER TABLE "ingest_sources" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD COLUMN "uncited_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD COLUMN "body_dropped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD COLUMN "body_delete_keys" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "ingest_sources_retention_idx" ON "ingest_sources" USING btree ("tenant_id","uncited_since","id") WHERE "ingest_sources"."body_dropped_at" IS NULL AND "ingest_sources"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "ingest_sources_body_cleanup_idx" ON "ingest_sources" USING btree ("tenant_id","id") WHERE cardinality("ingest_sources"."body_delete_keys") > 0;--> statement-breakpoint
CREATE INDEX "jobs_retention_source_idx" ON "jobs" USING btree ("tenant_id","brain_id",("payload"->>'sourceId'));--> statement-breakpoint
CREATE INDEX "page_sources_retention_idx" ON "page_sources" USING btree ("tenant_id","ingest_source_id");
UPDATE ingest_sources AS s
SET summary = CASE WHEN jsonb_typeof(metadata->'summary') = 'string' THEN metadata->>'summary' ELSE '' END,
    uncited_since = CASE WHEN status = 'completed' AND NOT EXISTS (
      SELECT 1 FROM page_sources AS ps
      WHERE ps.tenant_id = s.tenant_id AND ps.ingest_source_id = s.id
    ) THEN now() END;

CREATE FUNCTION source_completion_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status <> 'completed' THEN
    NEW.uncited_since := NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.page_sources
    WHERE tenant_id = NEW.tenant_id AND ingest_source_id = NEW.id
  ) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.uncited_since := COALESCE(NEW.compiled_at, now());
    ELSIF OLD.status <> 'completed' OR OLD.compiled_at IS DISTINCT FROM NEW.compiled_at THEN
      NEW.uncited_since := now();
    END IF;
  ELSE
    NEW.uncited_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_completion_clock
BEFORE INSERT OR UPDATE OF status, compiled_at ON ingest_sources
FOR EACH ROW EXECUTE FUNCTION source_completion_clock();

CREATE FUNCTION source_citation_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM 1 FROM public.ingest_sources
    WHERE tenant_id = OLD.tenant_id AND id = OLD.ingest_source_id FOR UPDATE;
    UPDATE public.ingest_sources AS s SET uncited_since = now()
    WHERE s.tenant_id = OLD.tenant_id AND s.id = OLD.ingest_source_id
      AND NOT EXISTS (
        SELECT 1 FROM public.page_sources AS ps
        WHERE ps.tenant_id = OLD.tenant_id AND ps.ingest_source_id = OLD.ingest_source_id
          AND (ps.page_id, ps.ingest_source_id) <> (OLD.page_id, OLD.ingest_source_id)
      );
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.ingest_sources SET uncited_since = NULL
    WHERE tenant_id = NEW.tenant_id AND id = NEW.ingest_source_id;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER source_citation_clock
BEFORE INSERT OR UPDATE OR DELETE ON page_sources
FOR EACH ROW EXECUTE FUNCTION source_citation_clock();

CREATE INDEX "idempotency_keys_retention_idx" ON "idempotency_keys" USING btree ("tenant_id","scope",("response_body"->>'id'));
