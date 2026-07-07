ALTER TABLE "operator"."authenticated_notice_run_processing_event_projection"
RENAME COLUMN "collector_run_token" TO "source_run_token";
--> statement-breakpoint
ALTER TABLE "operator"."authenticated_notice_run_processing_projection"
RENAME COLUMN "collector_run_token" TO "source_run_token";
--> statement-breakpoint
ALTER INDEX IF EXISTS "operator"."operator_auth_notice_run_event_token_occurred_idx"
RENAME TO "operator_auth_notice_run_event_source_run_occurred_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "operator"."operator_auth_notice_run_processing_token_projected_idx"
RENAME TO "operator_auth_notice_run_processing_source_run_projected_idx";
