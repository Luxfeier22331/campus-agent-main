ALTER TABLE "runtime"."request_observability_fact"
RENAME COLUMN "prompt_runtime_state" TO "model_execution_state";
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
RENAME COLUMN "prompt_runtime_detail" TO "model_execution_detail";
