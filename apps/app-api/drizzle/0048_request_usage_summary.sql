ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "billable_step_count" integer;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "model_usage_summary_json" jsonb;
