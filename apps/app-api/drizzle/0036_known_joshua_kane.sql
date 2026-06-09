CREATE SCHEMA IF NOT EXISTS "dining";
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dining"."floors" (
	"floor_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"label" text NOT NULL,
	"svg_asset_url" text NOT NULL,
	"sort_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dining"."halls" (
	"campus" text NOT NULL,
	"hall_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dining"."menu_items" (
	"menu_item_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dining"."release_snapshots" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dining"."releases" (
	"release_id" text PRIMARY KEY NOT NULL,
	"notes" text NOT NULL,
	"status" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dining"."stall_profiles" (
	"stall_profile_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"stall_type" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dining"."windows" (
	"window_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"floor_id" text NOT NULL,
	"label" text NOT NULL,
	"location_label" text NOT NULL,
	"geometry_json" jsonb NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_audit_events_action_occurred_idx" ON "dining"."audit_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_audit_events_object_occurred_idx" ON "dining"."audit_events" USING btree ("object_kind","object_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_floors_hall_idx" ON "dining"."floors" USING btree ("hall_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_menu_items_name_idx" ON "dining"."menu_items" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_menu_items_status_idx" ON "dining"."menu_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_menu_offerings_assignment_idx" ON "dining"."menu_offerings" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_menu_offerings_menu_item_idx" ON "dining"."menu_offerings" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_release_snapshots_release_idx" ON "dining"."release_snapshots" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_releases_status_created_idx" ON "dining"."releases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_releases_published_idx" ON "dining"."releases" USING btree ("published","published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_source_observations_status_observed_idx" ON "dining"."source_observations" USING btree ("status","observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_source_observations_target_idx" ON "dining"."source_observations" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_stall_profiles_status_idx" ON "dining"."stall_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_window_assignments_window_status_idx" ON "dining"."window_assignments" USING btree ("window_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_window_assignments_stall_profile_idx" ON "dining"."window_assignments" USING btree ("stall_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_windows_floor_idx" ON "dining"."windows" USING btree ("hall_id","floor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_windows_status_idx" ON "dining"."windows" USING btree ("status");
