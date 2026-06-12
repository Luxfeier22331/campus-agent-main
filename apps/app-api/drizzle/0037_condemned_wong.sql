CREATE TABLE "dining"."draft_versions" (
	"draft_version_id" text PRIMARY KEY NOT NULL,
	"version_number" integer NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."floorplan_assets" (
	"floorplan_asset_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"floor_id" text NOT NULL,
	"bucket" text DEFAULT 'campus-rag-derived' NOT NULL,
	"content_type" text DEFAULT 'image/svg+xml' NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"sanitized_svg_markup" text NOT NULL,
	"anchor_inventory_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_filename" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."release_candidate_validation_reports" (
	"validation_report_id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"status" text NOT NULL,
	"blockers_json" jsonb NOT NULL,
	"warnings_json" jsonb NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."release_candidates" (
	"candidate_id" text PRIMARY KEY NOT NULL,
	"base_draft_version_id" text NOT NULL,
	"status" text NOT NULL,
	"notes" text NOT NULL,
	"publish_mode" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"expected_predecessor_release_id" text,
	"snapshot_hash" text NOT NULL,
	"floorplan_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot_payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"published_release_id" text
);
--> statement-breakpoint
CREATE TABLE "dining"."release_latest_pointer" (
	"scope" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."release_schedule_jobs" (
	"schedule_job_id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dining"."floors" ADD COLUMN "draft_floorplan_asset_id" text DEFAULT 'dining_floorplan_asset:migrated' NOT NULL;--> statement-breakpoint
ALTER TABLE "dining"."release_snapshots" ADD COLUMN "svg_object_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dining"."release_snapshots" ADD COLUMN "snapshot_hash" text DEFAULT 'sha256:migrated' NOT NULL;--> statement-breakpoint
ALTER TABLE "dining"."releases" ADD COLUMN "candidate_id" text;--> statement-breakpoint
ALTER TABLE "dining"."releases" ADD COLUMN "predecessor_release_id" text;--> statement-breakpoint
ALTER TABLE "dining"."releases" ADD COLUMN "snapshot_hash" text DEFAULT 'sha256:migrated' NOT NULL;--> statement-breakpoint
ALTER TABLE "dining"."windows" ADD COLUMN "svg_anchor_id" text;--> statement-breakpoint
CREATE INDEX "dining_draft_versions_version_idx" ON "dining"."draft_versions" USING btree ("version_number");--> statement-breakpoint
CREATE INDEX "dining_floorplan_assets_floor_idx" ON "dining"."floorplan_assets" USING btree ("hall_id","floor_id");--> statement-breakpoint
CREATE INDEX "dining_floorplan_assets_status_idx" ON "dining"."floorplan_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dining_release_candidate_reports_candidate_idx" ON "dining"."release_candidate_validation_reports" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "dining_release_candidates_status_created_idx" ON "dining"."release_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dining_release_schedule_jobs_status_scheduled_idx" ON "dining"."release_schedule_jobs" USING btree ("status","scheduled_at");
