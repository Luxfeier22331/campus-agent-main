--> statement-breakpoint
ALTER TABLE "runtime"."request_execution"
ADD COLUMN "diagnostics_json" jsonb;
ALTER TABLE "operator"."request_projection"
ADD COLUMN "diagnostics_json" jsonb;