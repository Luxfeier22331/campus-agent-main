CREATE TABLE "official_web"."page_freshness" (
	"site_id" text NOT NULL,
	"normalized_canonical_url" text NOT NULL,
	"host" text NOT NULL,
	"page_family" text NOT NULL,
	"page_title_normalized" text NOT NULL,
	"discovered_from_url" text,
	"discovery_method" text NOT NULL,
	"last_fetch_disposition" text NOT NULL,
	"last_http_status" integer,
	"content_type" text,
	"etag" text,
	"last_modified" text,
	"response_body_hash" text,
	"main_content_hash" text,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_changed_at" timestamp with time zone,
	"last_not_modified_at" timestamp with time zone,
	"cadence_class" text NOT NULL,
	"priority_score" integer NOT NULL,
	"next_eligible_fetch_at" timestamp with time zone NOT NULL,
	"last_successful_run_id" text,
	"last_change_reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "official_web_page_freshness_pk" PRIMARY KEY("site_id","normalized_canonical_url")
);
--> statement-breakpoint
CREATE TABLE "official_web"."page_observations" (
	"observation_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_intent" text NOT NULL,
	"host" text NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text NOT NULL,
	"normalized_canonical_url" text NOT NULL,
	"page_family" text NOT NULL,
	"page_title_normalized" text NOT NULL,
	"discovery_method" text NOT NULL,
	"discovered_from_url" text,
	"raw_asset_id" text,
	"raw_version_id" text,
	"http_status" integer,
	"content_type" text,
	"etag" text,
	"last_modified" text,
	"response_body_hash" text,
	"main_content_hash" text,
	"fetch_disposition" text NOT NULL,
	"change_status" text NOT NULL,
	"last_change_reason" text NOT NULL,
	"cadence_class" text NOT NULL,
	"priority_score" integer NOT NULL,
	"next_eligible_fetch_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "official_web"."official_web_crawl_runs_site_scheduler_idx";--> statement-breakpoint
ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "run_intent" text DEFAULT 'baseline' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "ingestion_execution_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "ingestion_execution_ref" text;--> statement-breakpoint
ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "ingestion_execution_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "ingestion_execution_error_code" text;--> statement-breakpoint
ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "ingestion_execution_error_message" text;--> statement-breakpoint
ALTER TABLE "operator"."official_web_run_projection" ADD COLUMN "run_intent" text DEFAULT 'baseline' NOT NULL;--> statement-breakpoint
ALTER TABLE "operator"."official_web_run_projection" ADD COLUMN "ingestion_execution_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "operator"."official_web_run_projection" ADD COLUMN "ingestion_execution_ref" text;--> statement-breakpoint
ALTER TABLE "operator"."official_web_run_projection" ADD COLUMN "ingestion_execution_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operator"."official_web_run_projection" ADD COLUMN "ingestion_execution_error_code" text;--> statement-breakpoint
ALTER TABLE "operator"."official_web_run_projection" ADD COLUMN "ingestion_execution_error_message" text;--> statement-breakpoint
ALTER TABLE "operator"."official_web_site_projection" ADD COLUMN "latest_ingestion_execution_status" text;--> statement-breakpoint
ALTER TABLE "operator"."official_web_site_projection" ADD COLUMN "latest_ingestion_execution_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operator"."official_web_site_projection" ADD COLUMN "latest_ingestion_execution_error_code" text;--> statement-breakpoint
ALTER TABLE "official_web"."page_observations" ADD CONSTRAINT "page_observations_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "official_web_page_freshness_cadence_eligible_idx" ON "official_web"."page_freshness" USING btree ("cadence_class","next_eligible_fetch_at");--> statement-breakpoint
CREATE INDEX "official_web_page_freshness_host_updated_at_idx" ON "official_web"."page_freshness" USING btree ("host","updated_at");--> statement-breakpoint
CREATE INDEX "official_web_page_freshness_last_seen_at_idx" ON "official_web"."page_freshness" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "official_web_page_observations_run_observed_at_idx" ON "official_web"."page_observations" USING btree ("run_id","observed_at");--> statement-breakpoint
CREATE INDEX "official_web_page_observations_site_url_observed_at_idx" ON "official_web"."page_observations" USING btree ("site_id","normalized_canonical_url","observed_at");--> statement-breakpoint
CREATE INDEX "official_web_page_observations_change_status_observed_at_idx" ON "official_web"."page_observations" USING btree ("change_status","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_crawl_runs_site_scheduler_idx" ON "official_web"."crawl_runs" USING btree ("site_id","scheduler_run_key","run_intent");