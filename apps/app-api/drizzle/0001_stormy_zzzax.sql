ALTER TABLE "runtime"."request_execution" ADD COLUMN "diagnostics_json" jsonb;--> statement-breakpoint
ALTER TABLE "operator"."request_projection" ADD COLUMN "diagnostics_json" jsonb;