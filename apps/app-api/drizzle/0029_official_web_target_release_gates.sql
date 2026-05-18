CREATE TABLE "official_web"."target_release_gates" (
    "release_id" text PRIMARY KEY NOT NULL,
    "inventory_id" text NOT NULL,
    "job_id" text NOT NULL,
    "run_id" text,
    "summary_id" text,
    "decision" text NOT NULL,
    "status" text NOT NULL,
    "publish_alias" boolean DEFAULT false NOT NULL,
    "decided_by" text NOT NULL,
    "decided_at" timestamp with time zone NOT NULL,
    "notes" text,
    "evidence_json" jsonb NOT NULL,
    "execution_json" jsonb,
    "error_json" jsonb,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "official_web"."target_release_gates"
ADD CONSTRAINT "target_release_gates_job_id_target_jobs_job_id_fk"
FOREIGN KEY (
    "job_id"
) REFERENCES "official_web"."target_jobs" ("job_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "official_web"."target_release_gates"
ADD CONSTRAINT "target_release_gates_run_id_crawl_runs_run_id_fk"
FOREIGN KEY (
    "run_id"
) REFERENCES "official_web"."crawl_runs" ("run_id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "official_web"."target_release_gates"
ADD CONSTRAINT
"target_release_gates_summary_id_target_artifact_verification_summaries_summary_id_fk"
FOREIGN KEY (
    "summary_id"
) REFERENCES "official_web"."target_artifact_verification_summaries" (
    "summary_id"
) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_target_release_gates_inventory_run_decision_idx"
ON "official_web"."target_release_gates" USING btree (
    "inventory_id", "run_id", "decision"
);
--> statement-breakpoint
CREATE INDEX "official_web_target_release_gates_status_updated_at_idx"
ON "official_web"."target_release_gates" USING btree (
    "status", "updated_at"
);
