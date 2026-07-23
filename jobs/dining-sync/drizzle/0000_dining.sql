CREATE SCHEMA "dining";
--> statement-breakpoint
CREATE TABLE "dining"."catalog_overrides" (
	"override_id" text PRIMARY KEY NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"patch_json" jsonb NOT NULL,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."catalog_state" (
	"scope" text PRIMARY KEY NOT NULL,
	"draft_revision" integer NOT NULL,
	"base_release_id" text,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "dining_catalog_state_scope_check" CHECK ("dining"."catalog_state"."scope" = 'global'),
	CONSTRAINT "dining_catalog_state_revision_check" CHECK ("dining"."catalog_state"."draft_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "dining"."floors" (
	"floor_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"label" text NOT NULL,
	"floorplan_id" text NOT NULL,
	"floorplan_kind" text NOT NULL,
	"sort_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_floors_hall_floor_unique" UNIQUE("hall_id","floor_id"),
	CONSTRAINT "dining_floors_kind_check" CHECK ("dining"."floors"."floorplan_kind" in ('asset', 'placeholder'))
);
--> statement-breakpoint
CREATE TABLE "dining"."halls" (
	"campus" text NOT NULL,
	"hall_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_halls_status_check" CHECK ("dining"."halls"."status" = 'active')
);
--> statement-breakpoint
CREATE TABLE "dining"."menu_items" (
	"menu_item_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_menu_items_status_check" CHECK ("dining"."menu_items"."status" = 'active')
);
--> statement-breakpoint
CREATE TABLE "dining"."menu_offerings" (
	"offering_id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"price_label" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."operation_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" text NOT NULL,
	"summary_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."publication" (
	"scope" text PRIMARY KEY NOT NULL,
	"catalog_release_id" text,
	"review_revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_publication_scope_check" CHECK ("dining"."publication"."scope" = 'global'),
	CONSTRAINT "dining_publication_revision_check" CHECK ("dining"."publication"."review_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dining"."releases" (
	"release_id" text PRIMARY KEY NOT NULL,
	"predecessor_release_id" text,
	"rollback_of_release_id" text,
	"draft_revision" integer NOT NULL,
	"notes" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"validation_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "dining_releases_revision_check" CHECK ("dining"."releases"."draft_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "dining"."review_overrides" (
	"review_id" text PRIMARY KEY NOT NULL,
	"offering_id" text,
	"visibility" text,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."review_recheck_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"requested_at" timestamp with time zone NOT NULL,
	"requested_by" text NOT NULL,
	"completed_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "dining_review_recheck_status_check" CHECK ("dining"."review_recheck_requests"."status" in ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "dining_review_recheck_attempt_check" CHECK ("dining"."review_recheck_requests"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dining"."reviews" (
	"review_id" text PRIMARY KEY NOT NULL,
	"source_record_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"campus" text NOT NULL,
	"hall_name" text NOT NULL,
	"stall_name" text NOT NULL,
	"dish_name" text NOT NULL,
	"paid_price_label" text,
	"rating" integer,
	"comment" text,
	"contributor_name" text,
	"images_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"moderation_status" text NOT NULL,
	"visibility" text NOT NULL,
	"hall_id" text,
	"stall_profile_id" text,
	"window_id" text,
	"offering_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_reviews_rating_check" CHECK ("dining"."reviews"."rating" between 1 and 5),
	CONSTRAINT "dining_reviews_moderation_check" CHECK ("dining"."reviews"."moderation_status" in ('safe', 'blocked', 'uncertain')),
	CONSTRAINT "dining_reviews_visibility_check" CHECK ("dining"."reviews"."visibility" in ('published', 'hidden')),
	CONSTRAINT "dining_reviews_publication_check" CHECK ("dining"."reviews"."visibility" <> 'published' or ("dining"."reviews"."moderation_status" = 'safe' and "dining"."reviews"."hall_id" is not null and "dining"."reviews"."stall_profile_id" is not null and "dining"."reviews"."window_id" is not null and "dining"."reviews"."offering_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "dining"."source_observations" (
	"observation_id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_base_token" text,
	"source_table_id" text,
	"source_record_id" text,
	"target_kind" text NOT NULL,
	"target_id" text,
	"payload_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"processing_hash" text NOT NULL,
	"status" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_seen_run_id" text NOT NULL,
	"stale_at" timestamp with time zone,
	CONSTRAINT "dining_observations_source_check" CHECK ("dining"."source_observations"."source_type" in ('feishu_catalog', 'feishu_review')),
	CONSTRAINT "dining_observations_status_check" CHECK ("dining"."source_observations"."status" in ('accepted', 'blocked', 'observed'))
);
--> statement-breakpoint
CREATE TABLE "dining"."source_sync_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"stale_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	CONSTRAINT "dining_sync_runs_source_check" CHECK ("dining"."source_sync_runs"."source_type" in ('feishu_catalog', 'feishu_review')),
	CONSTRAINT "dining_sync_runs_status_check" CHECK ("dining"."source_sync_runs"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "dining_sync_runs_counts_check" CHECK ("dining"."source_sync_runs"."total_count" >= 0 and "dining"."source_sync_runs"."accepted_count" >= 0 and "dining"."source_sync_runs"."blocked_count" >= 0 and "dining"."source_sync_runs"."stale_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dining"."stall_profiles" (
	"stall_profile_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"stall_type" text NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_stall_profiles_status_check" CHECK ("dining"."stall_profiles"."status" = 'active')
);
--> statement-breakpoint
CREATE TABLE "dining"."window_assignments" (
	"assignment_id" text PRIMARY KEY NOT NULL,
	"window_id" text NOT NULL,
	"stall_profile_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_assignments_status_check" CHECK ("dining"."window_assignments"."status" = 'active')
);
--> statement-breakpoint
CREATE TABLE "dining"."windows" (
	"window_id" text PRIMARY KEY NOT NULL,
	"hall_id" text NOT NULL,
	"floor_id" text NOT NULL,
	"label" text NOT NULL,
	"location_label" text NOT NULL,
	"svg_anchor_id" text,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dining_windows_status_check" CHECK ("dining"."windows"."status" in ('active', 'closed', 'maintenance'))
);
--> statement-breakpoint
ALTER TABLE "dining"."catalog_state" ADD CONSTRAINT "catalog_state_base_release_id_releases_release_id_fk" FOREIGN KEY ("base_release_id") REFERENCES "dining"."releases"("release_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."floors" ADD CONSTRAINT "floors_hall_id_halls_hall_id_fk" FOREIGN KEY ("hall_id") REFERENCES "dining"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."menu_offerings" ADD CONSTRAINT "menu_offerings_assignment_id_window_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "dining"."window_assignments"("assignment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."menu_offerings" ADD CONSTRAINT "menu_offerings_menu_item_id_menu_items_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "dining"."menu_items"("menu_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."publication" ADD CONSTRAINT "publication_catalog_release_id_releases_release_id_fk" FOREIGN KEY ("catalog_release_id") REFERENCES "dining"."releases"("release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."releases" ADD CONSTRAINT "dining_releases_predecessor_fk" FOREIGN KEY ("predecessor_release_id") REFERENCES "dining"."releases"("release_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."releases" ADD CONSTRAINT "dining_releases_rollback_fk" FOREIGN KEY ("rollback_of_release_id") REFERENCES "dining"."releases"("release_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."review_overrides" ADD CONSTRAINT "review_overrides_review_id_reviews_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "dining"."reviews"("review_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."review_recheck_requests" ADD CONSTRAINT "review_recheck_requests_review_id_reviews_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "dining"."reviews"("review_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."source_observations" ADD CONSTRAINT "source_observations_last_seen_run_id_source_sync_runs_run_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "dining"."source_sync_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."window_assignments" ADD CONSTRAINT "window_assignments_window_id_windows_window_id_fk" FOREIGN KEY ("window_id") REFERENCES "dining"."windows"("window_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."window_assignments" ADD CONSTRAINT "window_assignments_stall_profile_id_stall_profiles_stall_profile_id_fk" FOREIGN KEY ("stall_profile_id") REFERENCES "dining"."stall_profiles"("stall_profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."windows" ADD CONSTRAINT "dining_windows_floor_fk" FOREIGN KEY ("hall_id","floor_id") REFERENCES "dining"."floors"("hall_id","floor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_catalog_overrides_target_idx" ON "dining"."catalog_overrides" USING btree ("target_kind","target_id") WHERE "dining"."catalog_overrides"."active";--> statement-breakpoint
CREATE INDEX "dining_floors_hall_idx" ON "dining"."floors" USING btree ("hall_id");--> statement-breakpoint
CREATE INDEX "dining_offerings_assignment_idx" ON "dining"."menu_offerings" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_offerings_assignment_item_uidx" ON "dining"."menu_offerings" USING btree ("assignment_id","menu_item_id");--> statement-breakpoint
CREATE INDEX "dining_operation_events_occurred_idx" ON "dining"."operation_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "dining_releases_created_idx" ON "dining"."releases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dining_review_recheck_status_idx" ON "dining"."review_recheck_requests" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_review_recheck_active_uidx" ON "dining"."review_recheck_requests" USING btree ("review_id") WHERE "dining"."review_recheck_requests"."status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "dining_reviews_offering_idx" ON "dining"."reviews" USING btree ("offering_id","visibility","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_reviews_source_uidx" ON "dining"."reviews" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "dining_observations_source_idx" ON "dining"."source_observations" USING btree ("source_type","status","stale_at");--> statement-breakpoint
CREATE INDEX "dining_observations_record_idx" ON "dining"."source_observations" USING btree ("source_type","source_table_id","source_record_id");--> statement-breakpoint
CREATE INDEX "dining_sync_runs_started_idx" ON "dining"."source_sync_runs" USING btree ("source_type","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_assignments_window_uidx" ON "dining"."window_assignments" USING btree ("window_id");--> statement-breakpoint
CREATE INDEX "dining_windows_floor_idx" ON "dining"."windows" USING btree ("hall_id","floor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_windows_floor_anchor_uidx" ON "dining"."windows" USING btree ("floor_id","svg_anchor_id") WHERE "dining"."windows"."svg_anchor_id" is not null;
