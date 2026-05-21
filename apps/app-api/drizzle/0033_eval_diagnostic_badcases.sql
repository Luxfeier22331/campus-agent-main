CREATE TABLE "operator"."eval_diagnostic_badcase_projection" (
    "badcase_id" text PRIMARY KEY NOT NULL,
    "snapshot_id" text NOT NULL,
    "eval_run_id" text NOT NULL,
    "source_report_schema" text NOT NULL,
    "source_git_head" text NOT NULL,
    "generated_at" timestamp with time zone NOT NULL,
    "surface_key" text NOT NULL,
    "case_id" text NOT NULL,
    "metric_name" text NOT NULL,
    "score_milli" integer NOT NULL,
    "threshold_milli" integer NOT NULL,
    "failure_stage" text NOT NULL,
    "cause_class" text NOT NULL,
    "metric_failure_reason" text NOT NULL,
    "query_preview" text NOT NULL,
    "expected_doc_ids_json" jsonb NOT NULL,
    "retrieved_context_ids_json" jsonb NOT NULL,
    "retrieved_doc_ids_json" jsonb NOT NULL,
    "supporting_doc_ids_json" jsonb NOT NULL,
    "supporting_chunk_ids_json" jsonb NOT NULL,
    "answer_shape" text,
    "presentation_kind" text,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_eval_diag_badcase_cause_generated_at_idx"
ON "operator"."eval_diagnostic_badcase_projection" USING btree ("cause_class", "generated_at");
--> statement-breakpoint
CREATE INDEX "operator_eval_diag_badcase_generated_at_idx"
ON "operator"."eval_diagnostic_badcase_projection" USING btree ("generated_at");
--> statement-breakpoint
CREATE INDEX "operator_eval_diag_badcase_surface_generated_at_idx"
ON "operator"."eval_diagnostic_badcase_projection" USING btree ("surface_key", "generated_at");
