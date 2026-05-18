CREATE TABLE "official_web"."run_admission_decisions" (
    "decision_id" text PRIMARY KEY NOT NULL,
    "run_id" text NOT NULL,
    "site_id" text NOT NULL,
    "decision" text NOT NULL,
    "reason_code" text NOT NULL,
    "reason" text NOT NULL,
    "decided_by" text NOT NULL,
    "decided_at" timestamp with time zone NOT NULL,
    "evidence_json" jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "official_web"."run_admission_decisions"
ADD CONSTRAINT "run_admission_decisions_run_id_crawl_runs_run_id_fk"
FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs" ("run_id")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "official_web_run_admission_decisions_run_idx"
ON "official_web"."run_admission_decisions" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "official_web_run_admission_decisions_site_decision_idx"
ON "official_web"."run_admission_decisions" USING btree (
    "site_id", "decision", "decided_at"
);
