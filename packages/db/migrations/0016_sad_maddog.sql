ALTER TABLE "jobs" ADD COLUMN "trace_context" text;--> statement-breakpoint
CREATE FUNCTION jobs_trace_context() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.trace_context IS NULL THEN
    NEW.trace_context := NULLIF(current_setting('app.traceparent', true), '');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER jobs_trace_context
BEFORE INSERT ON jobs
FOR EACH ROW EXECUTE FUNCTION jobs_trace_context();