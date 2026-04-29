--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_schema_version" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_routing_confidence" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_ambiguity_signal" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_context_resolution_state" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_context_reference_type" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_resolved_slots_json" jsonb;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_missing_slots_json" jsonb;
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "intent_ambiguity_reason" text;
