CREATE SCHEMA IF NOT EXISTS "wechat_official_account";
--> statement-breakpoint
CREATE TABLE "wechat_official_account"."capture_runs" (
    "run_id" text PRIMARY KEY NOT NULL,
    "source_channel" text NOT NULL,
    "provider" text NOT NULL,
    "account_name" text NOT NULL,
    "account_slug" text NOT NULL,
    "scheduler_run_key" text NOT NULL,
    "trigger_type" text NOT NULL,
    "collector_version" text NOT NULL,
    "provider_base_url" text NOT NULL,
    "request_summary_json" jsonb NOT NULL,
    "start_fingerprint_sha256" text NOT NULL,
    "status" text NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "last_heartbeat_at" timestamp with time zone,
    "latest_heartbeat_sequence" integer DEFAULT 0 NOT NULL,
    "finished_at" timestamp with time zone,
    "summary_json" jsonb,
    "terminal_payload_sha256" text,
    "terminal_error_code" text,
    "terminal_error_message" text,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wechat_official_account"."run_artifacts" (
    "artifact_id" text PRIMARY KEY NOT NULL,
    "run_id" text NOT NULL,
    "artifact_type" text NOT NULL,
    "object_key" text NOT NULL,
    "content_sha256" text NOT NULL,
    "byte_size" integer,
    "record_count" integer,
    "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wechat_official_account"."run_heartbeats" (
    "heartbeat_id" text PRIMARY KEY NOT NULL,
    "run_id" text NOT NULL,
    "sequence" integer NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "counts_json" jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wechat_official_account"."run_artifacts"
ADD CONSTRAINT "run_artifacts_run_id_capture_runs_run_id_fk"
FOREIGN KEY ("run_id")
REFERENCES "wechat_official_account"."capture_runs" ("run_id")
ON DELETE CASCADE
ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wechat_official_account"."run_heartbeats"
ADD CONSTRAINT "run_heartbeats_run_id_capture_runs_run_id_fk"
FOREIGN KEY ("run_id")
REFERENCES "wechat_official_account"."capture_runs" ("run_id")
ON DELETE CASCADE
ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_official_account_capture_runs_account_scheduler_idx"
ON "wechat_official_account"."capture_runs"
USING BTREE ("provider", "account_slug", "scheduler_run_key");
--> statement-breakpoint
CREATE INDEX "wechat_official_account_capture_runs_status_started_at_idx"
ON "wechat_official_account"."capture_runs"
USING BTREE ("status", "started_at");
--> statement-breakpoint
CREATE INDEX "wechat_official_account_capture_runs_account_started_at_idx"
ON "wechat_official_account"."capture_runs"
USING BTREE ("account_slug", "started_at");
--> statement-breakpoint
CREATE INDEX "wechat_official_account_run_artifacts_run_type_idx"
ON "wechat_official_account"."run_artifacts"
USING BTREE ("run_id", "artifact_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_official_account_run_artifacts_run_type_key_idx"
ON "wechat_official_account"."run_artifacts"
USING BTREE ("run_id", "artifact_type", "object_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_official_account_run_heartbeats_run_sequence_idx"
ON "wechat_official_account"."run_heartbeats"
USING BTREE ("run_id", "sequence");
--> statement-breakpoint
CREATE INDEX "wechat_official_account_run_heartbeats_run_observed_at_idx"
ON "wechat_official_account"."run_heartbeats"
USING BTREE ("run_id", "observed_at");
