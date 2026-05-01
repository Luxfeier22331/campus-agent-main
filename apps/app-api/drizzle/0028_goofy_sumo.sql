CREATE TABLE "official_web"."target_artifact_verification_summaries" (
	"summary_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"run_id" text,
	"source_handoff_id" text,
	"object_verification_id" text,
	"canonical_verification" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_job_candidates" (
	"candidate_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"site_id" text NOT NULL,
	"target_id" text NOT NULL,
	"normalized_candidate_url" text NOT NULL,
	"source_host" text NOT NULL,
	"eligibility_reason" text NOT NULL,
	"url_hint" text,
	"title_hint" text,
	"status" text NOT NULL,
	"priority_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_jobs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"target_id" text NOT NULL,
	"declaration_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"consumer_family" text NOT NULL,
	"owner_surface" text NOT NULL,
	"selected_write_target" text NOT NULL,
	"source_hosts_json" jsonb NOT NULL,
	"url_hints_json" jsonb NOT NULL,
	"title_hints_json" jsonb NOT NULL,
	"required_evidence_json" jsonb NOT NULL,
	"retention_policy" text NOT NULL,
	"review_policy" text NOT NULL,
	"materialization_policy" text NOT NULL,
	"inventory_only" boolean DEFAULT false NOT NULL,
	"latest_run_id" text,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_web"."target_page_attempts" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text,
	"run_id" text,
	"site_id" text NOT NULL,
	"target_id" text NOT NULL,
	"normalized_canonical_url" text NOT NULL,
	"attempt_status" text NOT NULL,
	"http_status" integer,
	"artifact_object_key" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "official_web"."target_artifact_verification_summaries" ADD CONSTRAINT "target_artifact_verification_summaries_job_id_target_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "official_web"."target_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_artifact_verification_summaries" ADD CONSTRAINT "target_artifact_verification_summaries_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_job_candidates" ADD CONSTRAINT "target_job_candidates_job_id_target_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "official_web"."target_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_jobs" ADD CONSTRAINT "target_jobs_latest_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("latest_run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_page_attempts" ADD CONSTRAINT "target_page_attempts_job_id_target_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "official_web"."target_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_page_attempts" ADD CONSTRAINT "target_page_attempts_candidate_id_target_job_candidates_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "official_web"."target_job_candidates"("candidate_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_web"."target_page_attempts" ADD CONSTRAINT "target_page_attempts_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_artifact_summary_job_run_idx" ON "official_web"."target_artifact_verification_summaries" USING btree ("job_id","run_id");--> statement-breakpoint
CREATE INDEX "official_web_target_artifact_summary_canonical_idx" ON "official_web"."target_artifact_verification_summaries" USING btree ("canonical_verification","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_candidates_job_url_idx" ON "official_web"."target_job_candidates" USING btree ("job_id","normalized_candidate_url");--> statement-breakpoint
CREATE INDEX "official_web_target_candidates_site_status_idx" ON "official_web"."target_job_candidates" USING btree ("site_id","status","priority_score");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_jobs_idempotency_idx" ON "official_web"."target_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "official_web_target_jobs_site_status_idx" ON "official_web"."target_jobs" USING btree ("site_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_jobs_site_target_version_idx" ON "official_web"."target_jobs" USING btree ("site_id","target_id","declaration_version");--> statement-breakpoint
CREATE INDEX "official_web_target_attempts_job_attempted_idx" ON "official_web"."target_page_attempts" USING btree ("job_id","attempted_at");--> statement-breakpoint
CREATE INDEX "official_web_target_attempts_run_idx" ON "official_web"."target_page_attempts" USING btree ("run_id");