DROP TABLE "operator"."authenticated_notice_processing_event_projection" CASCADE;--> statement-breakpoint
DROP TABLE "operator"."authenticated_notice_processing_projection" CASCADE;--> statement-breakpoint
DROP TABLE "operator"."authenticated_notice_run_processing_event_projection" CASCADE;--> statement-breakpoint
DROP TABLE "operator"."authenticated_notice_run_processing_projection" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."crawl_runs" CASCADE;--> statement-breakpoint
DROP TABLE "operator"."official_web_release_task_event_projection" CASCADE;--> statement-breakpoint
DROP TABLE "operator"."official_web_release_task_projection" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."run_admission_decisions" CASCADE;--> statement-breakpoint
DROP TABLE "operator"."official_web_run_projection" CASCADE;--> statement-breakpoint
DROP TABLE "operator"."official_web_site_projection" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."target_artifact_verification_summaries" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."target_job_candidates" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."target_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."target_page_attempts" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."target_release_gates" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."page_freshness" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."page_observations" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."run_artifacts" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."run_heartbeats" CASCADE;--> statement-breakpoint
DROP TABLE "official_web"."run_outbox" CASCADE;--> statement-breakpoint
DROP TABLE "wechat_official_account"."capture_runs" CASCADE;--> statement-breakpoint
DROP TABLE "wechat_official_account"."run_artifacts" CASCADE;--> statement-breakpoint
DROP TABLE "wechat_official_account"."run_heartbeats" CASCADE;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "resolved_targets_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "requested_scope_summary";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "version_query_mode";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "version_query_summary";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "resolved_scope_summary";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "scope_class";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "answer_eval_fingerprint_json";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "llm_io_fingerprint_json";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "resolved_targets_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "requested_scope";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "version_query_json";--> statement-breakpoint
DROP SCHEMA IF EXISTS "official_web" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "operator" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "wechat_official_account" CASCADE;
