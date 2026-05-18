CREATE TABLE "operator"."official_web_release_task_event_projection" (
    "event_id" text PRIMARY KEY NOT NULL,
    "task_id" text NOT NULL,
    "inventory_id" text NOT NULL,
    "job_id" text NOT NULL,
    "run_id" text NOT NULL,
    "stage" text NOT NULL,
    "status" text NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "summary" text NOT NULL,
    "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."official_web_release_task_projection" (
    "task_id" text PRIMARY KEY NOT NULL,
    "task_type" text NOT NULL,
    "source_channel" text NOT NULL,
    "inventory_id" text NOT NULL,
    "job_id" text NOT NULL,
    "run_id" text NOT NULL,
    "selected_write_target" text,
    "lifecycle_status" text NOT NULL,
    "latest_stage" text NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "input_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "output_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "timeline_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "last_error_code" text,
    "last_error_message" text,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "projected_at" timestamp with time zone NOT NULL,
    "producer_version" text NOT NULL,
    "redaction_version" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_event_task_occurred_idx"
ON "operator"."official_web_release_task_event_projection" USING btree (
    "task_id", "occurred_at"
);
--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_event_run_occurred_idx"
ON "operator"."official_web_release_task_event_projection" USING btree (
    "run_id", "occurred_at"
);
--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_inventory_projected_idx"
ON "operator"."official_web_release_task_projection" USING btree (
    "inventory_id", "projected_at"
);
--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_job_projected_idx"
ON "operator"."official_web_release_task_projection" USING btree (
    "job_id", "projected_at"
);
--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_run_projected_idx"
ON "operator"."official_web_release_task_projection" USING btree (
    "run_id", "projected_at"
);
--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_status_projected_idx"
ON "operator"."official_web_release_task_projection" USING btree (
    "lifecycle_status", "projected_at"
);
--> statement-breakpoint
CREATE INDEX "operator_ow_release_task_target_projected_idx"
ON "operator"."official_web_release_task_projection" USING btree (
    "selected_write_target", "projected_at"
);
