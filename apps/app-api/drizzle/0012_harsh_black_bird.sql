--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "retrieval_adequacy_verdict" text;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "retrieval_adequacy_reason" text;
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "claim_support_summary_json" jsonb;