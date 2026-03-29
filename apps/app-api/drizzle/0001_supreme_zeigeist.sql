CREATE TABLE "official_web"."crawl_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"scheduler_run_key" text NOT NULL,
	"trigger_type" text NOT NULL,
	"collector_version" text NOT NULL,
	"config_version" text NOT NULL,
	"crawl_policy_version" text NOT NULL,
	"start_fingerprint_sha256" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"latest_heartbeat_sequence" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"host_set_json" jsonb NOT NULL,
	"seed_set_json" jsonb NOT NULL,
	"summary_json" jsonb,
	"terminal_payload_sha256" text,
	"terminal_error_code" text,
	"terminal_error_message" text,
	"ingestion_dispatch_status" text DEFAULT 'pending' NOT NULL,
	"ingestion_dispatched_at" timestamp with time zone,
	"ingestion_dispatch_ref" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."official_web_run_projection" (
	"run_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"status" text NOT NULL,
	"ingestion_dispatch_status" text NOT NULL,
	"ingestion_dispatch_ref" text,
	"collector_version" text,
	"config_version" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"summary_json" jsonb,
	"artifacts_json" jsonb NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."official_web_site_projection" (
	"site_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"host_roots_json" jsonb NOT NULL,
	"latest_run_id" text,
	"latest_run_status" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"latest_collector_version" text,
	"latest_config_version" text,
	"latest_ingestion_dispatch_status" text,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."run_artifacts" (
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
CREATE TABLE "official_web"."run_heartbeats" (
	"heartbeat_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"counts_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."run_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "official_web"."run_artifacts" ADD CONSTRAINT "run_artifacts_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."run_heartbeats" ADD CONSTRAINT "run_heartbeats_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."run_outbox" ADD CONSTRAINT "run_outbox_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_crawl_runs_site_scheduler_idx" ON "official_web"."crawl_runs" USING btree ("site_id","scheduler_run_key");--> statement-breakpoint
CREATE INDEX "official_web_crawl_runs_status_started_at_idx" ON "official_web"."crawl_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "official_web_crawl_runs_site_started_at_idx" ON "official_web"."crawl_runs" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "official_web_crawl_runs_dispatch_status_updated_at_idx" ON "official_web"."crawl_runs" USING btree ("ingestion_dispatch_status","updated_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_run_projection_site_started_at_idx" ON "operator"."official_web_run_projection" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_run_projection_status_started_at_idx" ON "operator"."official_web_run_projection" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_run_projection_dispatch_started_at_idx" ON "operator"."official_web_run_projection" USING btree ("ingestion_dispatch_status","started_at");--> statement-breakpoint
CREATE INDEX "operator_official_web_site_projection_status_projected_at_idx" ON "operator"."official_web_site_projection" USING btree ("latest_run_status","projected_at");--> statement-breakpoint
CREATE INDEX "official_web_run_artifacts_run_type_idx" ON "official_web"."run_artifacts" USING btree ("run_id","artifact_type");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_run_artifacts_run_type_key_idx" ON "official_web"."run_artifacts" USING btree ("run_id","artifact_type","object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_run_heartbeats_run_sequence_idx" ON "official_web"."run_heartbeats" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "official_web_run_heartbeats_run_observed_at_idx" ON "official_web"."run_heartbeats" USING btree ("run_id","observed_at");--> statement-breakpoint
CREATE INDEX "official_web_run_outbox_processed_available_idx" ON "official_web"."run_outbox" USING btree ("processed_at","available_at");--> statement-breakpoint
CREATE INDEX "official_web_run_outbox_run_occurred_idx" ON "official_web"."run_outbox" USING btree ("run_id","occurred_at");