ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_capability" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_task_kind" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_launch_state" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_next_action" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_scope_class" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_scope_reason" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_policy_reason" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_classifier_version" text;
