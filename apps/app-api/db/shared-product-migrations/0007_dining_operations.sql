CREATE SCHEMA IF NOT EXISTS "dining";

CREATE TABLE IF NOT EXISTS "dining"."halls" (
	"hall_id" text PRIMARY KEY NOT NULL,
	"campus" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "dining"."floors" (
	"floor_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"label" text NOT NULL,
	"floorplan_id" text NOT NULL,
	"floorplan_sha256" text NOT NULL,
	"svg_asset_url" text NOT NULL,
	"sort_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_floors_hall_idx" ON "dining"."floors" USING btree ("hall_id");

CREATE TABLE IF NOT EXISTS "dining"."windows" (
	"window_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"floor_id" text NOT NULL,
	"label" text NOT NULL,
	"location_label" text NOT NULL,
	"svg_anchor_id" text,
	"geometry_json" jsonb NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_windows_floor_idx" ON "dining"."windows" USING btree ("hall_id","floor_id");
CREATE INDEX IF NOT EXISTS "dining_windows_status_idx" ON "dining"."windows" USING btree ("status");

CREATE TABLE IF NOT EXISTS "dining"."stall_profiles" (
	"stall_profile_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"stall_type" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_stall_profiles_status_idx" ON "dining"."stall_profiles" USING btree ("status");

CREATE TABLE IF NOT EXISTS "dining"."window_assignments" (
	"assignment_id" text PRIMARY KEY NOT NULL,
	"window_id" text NOT NULL,
	"stall_profile_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_window_assignments_window_status_idx" ON "dining"."window_assignments" USING btree ("window_id","status");
CREATE INDEX IF NOT EXISTS "dining_window_assignments_stall_profile_idx" ON "dining"."window_assignments" USING btree ("stall_profile_id");

CREATE TABLE IF NOT EXISTS "dining"."menu_items" (
	"menu_item_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_menu_items_name_idx" ON "dining"."menu_items" USING btree ("name");
CREATE INDEX IF NOT EXISTS "dining_menu_items_status_idx" ON "dining"."menu_items" USING btree ("status");

CREATE TABLE IF NOT EXISTS "dining"."menu_offerings" (
	"offering_id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"price_label" text NOT NULL,
	"spec_label" text,
	"sale_status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_menu_offerings_assignment_idx" ON "dining"."menu_offerings" USING btree ("assignment_id");
CREATE INDEX IF NOT EXISTS "dining_menu_offerings_menu_item_idx" ON "dining"."menu_offerings" USING btree ("menu_item_id");

CREATE TABLE IF NOT EXISTS "dining"."source_observations" (
	"observation_id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text,
	"payload_json" jsonb NOT NULL,
	"status" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text
);

CREATE INDEX IF NOT EXISTS "dining_source_observations_status_observed_idx" ON "dining"."source_observations" USING btree ("status","observed_at");
CREATE INDEX IF NOT EXISTS "dining_source_observations_target_idx" ON "dining"."source_observations" USING btree ("target_kind","target_id");

CREATE TABLE IF NOT EXISTS "dining"."draft_versions" (
	"draft_version_id" text PRIMARY KEY NOT NULL,
	"version_number" integer NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_draft_versions_version_idx" ON "dining"."draft_versions" USING btree ("version_number");

CREATE TABLE IF NOT EXISTS "dining"."release_candidates" (
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

CREATE INDEX IF NOT EXISTS "dining_release_candidates_status_created_idx" ON "dining"."release_candidates" USING btree ("status","created_at");

CREATE TABLE IF NOT EXISTS "dining"."release_candidate_validation_reports" (
	"validation_report_id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"status" text NOT NULL,
	"blockers_json" jsonb NOT NULL,
	"warnings_json" jsonb NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_release_candidate_reports_candidate_idx" ON "dining"."release_candidate_validation_reports" USING btree ("candidate_id");

CREATE TABLE IF NOT EXISTS "dining"."release_schedule_jobs" (
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

CREATE INDEX IF NOT EXISTS "dining_release_schedule_jobs_status_scheduled_idx" ON "dining"."release_schedule_jobs" USING btree ("status","scheduled_at");

CREATE TABLE IF NOT EXISTS "dining"."releases" (
	"release_id" text PRIMARY KEY NOT NULL,
	"candidate_id" text,
	"notes" text NOT NULL,
	"status" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"predecessor_release_id" text,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_releases_status_created_idx" ON "dining"."releases" USING btree ("status","created_at");
CREATE INDEX IF NOT EXISTS "dining_releases_published_idx" ON "dining"."releases" USING btree ("published","published_at");

CREATE TABLE IF NOT EXISTS "dining"."release_snapshots" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"svg_object_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_release_snapshots_release_idx" ON "dining"."release_snapshots" USING btree ("release_id");

CREATE TABLE IF NOT EXISTS "dining"."release_latest_pointer" (
	"scope" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "dining"."audit_events" (
	"audit_event_id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_display_name" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"object_id" text NOT NULL,
	"object_kind" text NOT NULL,
	"after_json" jsonb,
	"before_json" jsonb,
	"occurred_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_audit_events_action_occurred_idx" ON "dining"."audit_events" USING btree ("action","occurred_at");
CREATE INDEX IF NOT EXISTS "dining_audit_events_object_occurred_idx" ON "dining"."audit_events" USING btree ("object_kind","object_id","occurred_at");
