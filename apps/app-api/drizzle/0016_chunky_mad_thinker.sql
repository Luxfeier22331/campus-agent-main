--> statement-breakpoint
ALTER TABLE "runtime"."request_execution"
ADD COLUMN "safety_identifier" text;
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "safety_identifier" text;