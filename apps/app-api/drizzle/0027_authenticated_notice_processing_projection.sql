CREATE TABLE "operator"."authenticated_notice_processing_event_projection" (
	"event_id" text PRIMARY KEY NOT NULL,
	"processing_id" text NOT NULL,
	"notice_key" text NOT NULL,
	"notice_id" text NOT NULL,
	"run_id" text,
	"job_id" text,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."authenticated_notice_processing_projection" (
	"processing_id" text PRIMARY KEY NOT NULL,
	"notice_key" text NOT NULL,
	"source_channel" text NOT NULL,
	"source_surface" text NOT NULL,
	"site_id" text NOT NULL,
	"notice_id" text NOT NULL,
	"title" text NOT NULL,
	"run_id" text,
	"job_id" text,
	"replay_batch_id" text,
	"enqueue_source" text,
	"queue_status" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"latest_stage" text NOT NULL,
	"target_surface" text,
	"candidate_kind" text,
	"materialization_status" text,
	"release_id" text,
	"current" boolean DEFAULT false NOT NULL,
	"tool_ready" boolean DEFAULT false NOT NULL,
	"read_model_counts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"child_task_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeline_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"downstream_json" jsonb,
	"last_error_code" text,
	"last_error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"projected_at" timestamp with time zone NOT NULL,
	"producer_version" text NOT NULL,
	"redaction_version" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_auth_notice_event_processing_occurred_idx" ON "operator"."authenticated_notice_processing_event_projection" USING btree ("processing_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_event_notice_occurred_idx" ON "operator"."authenticated_notice_processing_event_projection" USING btree ("notice_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_notice_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("notice_id","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_notice_key_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("notice_key","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_status_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("lifecycle_status","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_target_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("target_surface","candidate_kind","projected_at");--> statement-breakpoint
CREATE INDEX "operator_auth_notice_processing_run_projected_idx" ON "operator"."authenticated_notice_processing_projection" USING btree ("run_id","projected_at");