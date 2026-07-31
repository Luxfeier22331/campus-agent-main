CREATE SCHEMA "dining";
--> statement-breakpoint
CREATE TABLE "dining"."map_draft" (
	"bundle_json" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"revision" integer NOT NULL,
	"scope" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "dining_map_draft_fingerprint_check" CHECK ("dining"."map_draft"."fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "dining_map_draft_scope_check" CHECK ("dining"."map_draft"."scope" = 'global'),
	CONSTRAINT "dining_map_draft_revision_check" CHECK ("dining"."map_draft"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "dining"."map_publication" (
	"release_id" text NOT NULL,
	"scope" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "dining_map_publication_scope_check" CHECK ("dining"."map_publication"."scope" = 'global')
);
--> statement-breakpoint
CREATE TABLE "dining"."map_releases" (
	"bundle_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"draft_revision" integer NOT NULL,
	"kind" text NOT NULL,
	"public_payload_json" jsonb NOT NULL,
	"release_id" text PRIMARY KEY NOT NULL,
	"restored_from_release_id" text,
	"snapshot_hash" text NOT NULL,
	CONSTRAINT "dining_map_releases_revision_check" CHECK ("dining"."map_releases"."draft_revision" > 0),
	CONSTRAINT "dining_map_releases_kind_check" CHECK ("dining"."map_releases"."kind" in ('publish', 'restore')),
	CONSTRAINT "dining_map_releases_snapshot_hash_check" CHECK ("dining"."map_releases"."snapshot_hash" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "dining"."menu_items" (
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"menu_item_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_text" text,
	"sort_order" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	"window_id" text NOT NULL,
	CONSTRAINT "dining_menu_items_name_check" CHECK (length(btrim("dining"."menu_items"."name")) between 1 and 80),
	CONSTRAINT "dining_menu_items_price_check" CHECK ("dining"."menu_items"."price_text" is null or length(btrim("dining"."menu_items"."price_text")) between 1 and 40),
	CONSTRAINT "dining_menu_items_sort_order_check" CHECK ("dining"."menu_items"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dining"."review_edits" (
	"edit_id" text PRIMARY KEY NOT NULL,
	"edited_at" timestamp with time zone NOT NULL,
	"edited_by" text NOT NULL,
	"next_body" text NOT NULL,
	"previous_body" text NOT NULL,
	"review_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining"."review_reports" (
	"created_at" timestamp with time zone NOT NULL,
	"details" text,
	"reason" text NOT NULL,
	"report_id" text PRIMARY KEY NOT NULL,
	"reporter_user_id" text NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"review_id" text NOT NULL,
	CONSTRAINT "dining_review_reports_reason_check" CHECK ("dining"."review_reports"."reason" in ('spam', 'inappropriate', 'privacy', 'other')),
	CONSTRAINT "dining_review_reports_details_check" CHECK ("dining"."review_reports"."details" is null or length("dining"."review_reports"."details") <= 300),
	CONSTRAINT "dining_review_reports_resolution_check" CHECK ("dining"."review_reports"."resolution" is null or "dining"."review_reports"."resolution" in ('keep', 'hide')),
	CONSTRAINT "dining_review_reports_resolution_state_check" CHECK (("dining"."review_reports"."resolution" is null and "dining"."review_reports"."resolved_at" is null and "dining"."review_reports"."resolved_by" is null)
				or ("dining"."review_reports"."resolution" is not null and "dining"."review_reports"."resolved_at" is not null and "dining"."review_reports"."resolved_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "dining"."reviews" (
	"anonymous" boolean NOT NULL,
	"author_display_name" text NOT NULL,
	"author_id" text NOT NULL,
	"author_kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"edited_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" text,
	"idempotency_key" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"review_id" text PRIMARY KEY NOT NULL,
	"submission_date" date NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "dining_reviews_author_kind_check" CHECK ("dining"."reviews"."author_kind" in ('member', 'operator')),
	CONSTRAINT "dining_reviews_body_check" CHECK (length(btrim("dining"."reviews"."body")) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "dining"."map_publication" ADD CONSTRAINT "map_publication_release_id_map_releases_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "dining"."map_releases"("release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."map_releases" ADD CONSTRAINT "dining_map_releases_restored_from_release_id_fkey" FOREIGN KEY ("restored_from_release_id") REFERENCES "dining"."map_releases"("release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."review_edits" ADD CONSTRAINT "review_edits_review_id_reviews_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "dining"."reviews"("review_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."review_reports" ADD CONSTRAINT "review_reports_review_id_reviews_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "dining"."reviews"("review_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining"."reviews" ADD CONSTRAINT "reviews_menu_item_id_menu_items_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "dining"."menu_items"("menu_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dining_map_releases_created_idx" ON "dining"."map_releases" USING btree ("created_at" DESC NULLS LAST,"release_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dining_menu_items_window_sort_idx" ON "dining"."menu_items" USING btree ("window_id","archived_at","sort_order","menu_item_id");--> statement-breakpoint
CREATE INDEX "dining_review_edits_review_idx" ON "dining"."review_edits" USING btree ("review_id","edited_at","edit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_review_reports_reporter_uidx" ON "dining"."review_reports" USING btree ("review_id","reporter_user_id");--> statement-breakpoint
CREATE INDEX "dining_review_reports_pending_idx" ON "dining"."review_reports" USING btree ("resolved_at","created_at","report_id");--> statement-breakpoint
CREATE INDEX "dining_reviews_menu_created_idx" ON "dining"."reviews" USING btree ("menu_item_id","created_at" DESC NULLS LAST,"review_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dining_reviews_member_limit_idx" ON "dining"."reviews" USING btree ("author_kind","author_id","menu_item_id","submission_date");--> statement-breakpoint
CREATE UNIQUE INDEX "dining_reviews_idempotency_uidx" ON "dining"."reviews" USING btree ("author_kind","author_id","idempotency_key");
