--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "prompt_id" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "prompt_version" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "template_sha256" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "prompt_runtime_state" text;
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "prompt_runtime_detail" text;
