LOCK TABLE change_events, connections, ingest_sources IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brain_id" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"action" text,
	"payload" jsonb NOT NULL,
	CONSTRAINT "webhook_events_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "webhook_events_kind" CHECK ("webhook_events"."kind" IN ('change', 'connection', 'import')),
	CONSTRAINT "webhook_events_action" CHECK (("webhook_events"."kind" = 'change' AND "webhook_events"."action" IS NOT NULL) OR ("webhook_events"."kind" <> 'change' AND "webhook_events"."action" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_tenant_id_event_id_change_events_tenant_id_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_subject_id_brain_id_brains_tenant_id_subject_id_id_fk" FOREIGN KEY ("tenant_id","subject_id","brain_id") REFERENCES "public"."brains"("tenant_id","subject_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_events_tenant_brain_idx" ON "webhook_events" USING btree ("tenant_id","brain_id");--> statement-breakpoint
INSERT INTO webhook_events (id, tenant_id, brain_id, subject_id, kind, action, payload)
SELECT e.id, e.tenant_id, e.brain_id, b.subject_id, 'change', e.action,
  jsonb_build_object('brainId', e.brain_id, 'pageId', e.page_id,
    'changeSummary', e.change_summary, 'fromVersion', e.from_version,
    'toVersion', e.to_version,
    'createdAt', to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
FROM change_events e JOIN brains b ON b.tenant_id = e.tenant_id AND b.id = e.brain_id;

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_event_id_webhook_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."webhook_events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_webhook_event_unique" UNIQUE("tenant_id","webhook_id","event_id");

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON webhook_events TO memtavi_app;

CREATE FUNCTION enqueue_webhook_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO jobs (tenant_id, brain_id, type, payload, idempotency_key, max_attempts)
  SELECT NEW.tenant_id, NEW.brain_id, 'webhook.deliver',
    jsonb_build_object('webhookId', w.id, 'eventId', NEW.id),
    'webhook:' || NEW.id || ':' || w.id::text, 5
  FROM webhooks w
  WHERE w.tenant_id = NEW.tenant_id AND w.subject_id = NEW.subject_id AND w.active
    AND w.events && CASE NEW.kind
      WHEN 'change' THEN ARRAY['brain.page.updated', 'brain.change.new']
      WHEN 'connection' THEN ARRAY['brain.connection.new']
      WHEN 'import' THEN ARRAY['brain.import.progress']
    END
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_event_enqueue AFTER INSERT ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION enqueue_webhook_event();

CREATE FUNCTION record_webhook_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO webhook_events (id, tenant_id, brain_id, subject_id, kind, action, payload)
  SELECT NEW.id, NEW.tenant_id, NEW.brain_id, b.subject_id, 'change', NEW.action,
    jsonb_build_object('brainId', NEW.brain_id, 'pageId', NEW.page_id,
      'changeSummary', NEW.change_summary, 'fromVersion', NEW.from_version,
      'toVersion', NEW.to_version,
      'createdAt', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  FROM brains b WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.brain_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_change_record AFTER INSERT ON change_events
  FOR EACH ROW EXECUTE FUNCTION record_webhook_change();

CREATE FUNCTION record_webhook_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO webhook_events (id, tenant_id, brain_id, subject_id, kind, payload)
  SELECT NEW.id, NEW.tenant_id, NEW.brain_id, b.subject_id, 'connection',
    jsonb_build_object('brainId', NEW.brain_id, 'connectionId', NEW.id,
      'pageAId', NEW.page_a_id, 'pageBId', NEW.page_b_id, 'similarity', NEW.similarity,
      'strength', NEW.strength, 'reasoning', NEW.reasoning,
      'createdAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  FROM brains b WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.brain_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_connection_record AFTER INSERT ON connections
  FOR EACH ROW WHEN (NEW.source = 'auto') EXECUTE FUNCTION record_webhook_connection();

CREATE FUNCTION record_webhook_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO webhook_events (id, tenant_id, brain_id, subject_id, kind, payload)
  VALUES (NEW.id || ':' || NEW.status || ':' || gen_random_uuid()::text,
    NEW.tenant_id, NEW.brain_id, NEW.subject_id, 'import',
    jsonb_build_object('brainId', NEW.brain_id, 'sourceId', NEW.id,
      'status', NEW.status, 'affectedPageIds', NEW.affected_page_ids,
      'createdAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_import_record AFTER UPDATE OF status ON ingest_sources
  FOR EACH ROW WHEN (NEW.status IN ('completed', 'failed') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION record_webhook_import();

CREATE FUNCTION delete_webhook_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM webhook_events WHERE tenant_id = OLD.tenant_id AND id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER webhook_change_delete AFTER DELETE ON change_events
  FOR EACH ROW EXECUTE FUNCTION delete_webhook_change();
