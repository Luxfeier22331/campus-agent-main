--> statement-breakpoint
ALTER TABLE "runtime"."request_execution"
ADD COLUMN "resolved_scope_json" jsonb;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "resolved_scope_summary" text;
ALTER TABLE "operator"."request_projection"
ADD COLUMN "resolved_scope_json" jsonb;