CREATE TABLE "operator"."authenticated_notice_run_processing_event_projection" (
	"event_id" text PRIMARY KEY NOT NULL,
	"run_processing_id" text NOT NULL,
	"run_key" text NOT NULL,
	"collector_run_token" text NOT NULL,
	"run_id" text NOT NULL,
	"job_id" text,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."authenticated_notice_run_processing_projection" (
	"run_processing_id" text PRIMARY KEY NOT NULL,
	"run_key" text NOT NULL,
	"source_channel" text NOT NULL,
	"source_surface" text NOT NULL,
	"site_id" text NOT NULL,
	"collector_run_token" text NOT NULL,
	"run_id" text NOT NULL,
	"replay_batch_id" text,
	"enqueue_source" text,
	"lifecycle_status" text NOT NULL,
	"latest_stage" text NOT NULL,
	"latest_queue_status" text NOT NULL,
	"queue_job_count" integer DEFAULT 0 NOT NULL,
	"queue_status_counts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"source_truth_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"child_task_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"downstream_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"job_summaries_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeline_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL,
	"producer_version" text NOT NULL,
	"redaction_version" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_event_processing_occurred_idx" ON "operator"."authenticated_notice_run_processing_event_projection" USING btree ("run_processing_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_event_token_occurred_idx" ON "operator"."authenticated_notice_run_processing_event_projection" USING btree ("collector_run_token","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_token_projected_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("collector_run_token","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_run_projected_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("run_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_site_status_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("site_id","lifecycle_status","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_run_processing_queue_status_idx" ON "operator"."authenticated_notice_run_processing_projection" USING btree ("latest_queue_status","projected_at");
