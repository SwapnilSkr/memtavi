ALTER TABLE "usage_ledger" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- usage_ledger is young and small, so a plain index keeps this migration transactional and atomic.
CREATE INDEX "usage_ledger_tenant_created_idx" ON "usage_ledger" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
INSERT INTO "budget_caps" ("tenant_id", "monthly_usd", "hard_stop", "current_period_spend")
SELECT "id", 20, true, 0 FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
