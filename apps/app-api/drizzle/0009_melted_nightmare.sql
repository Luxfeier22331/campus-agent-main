ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "policy_reason" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "semantic_outcome" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "scope_class" text;