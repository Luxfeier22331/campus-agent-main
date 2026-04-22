ALTER TABLE "runtime"."request_execution"
ADD COLUMN "version_query_json" jsonb;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "version_query_mode" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "version_query_summary" text;--> statement-breakpoint
ALTER TABLE "operator"."request_projection" ADD COLUMN "version_query_json" jsonb;
