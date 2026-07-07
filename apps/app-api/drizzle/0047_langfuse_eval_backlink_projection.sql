CREATE TABLE "operator"."langfuse_eval_backlink_projection" (
    "eval_backlink_id" text PRIMARY KEY NOT NULL,
    "trace_id" text NOT NULL,
    "eval_run_id" text NOT NULL,
    "score_name" text NOT NULL,
    "score_value_json" jsonb NOT NULL,
    "release" text NOT NULL,
    "environment" text NOT NULL,
    "langfuse_url" text NOT NULL,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_langfuse_eval_backlink_trace_projected_at_idx"
ON "operator"."langfuse_eval_backlink_projection" USING btree (
    "trace_id", "projected_at"
);
--> statement-breakpoint
CREATE INDEX "operator_langfuse_eval_backlink_eval_score_idx"
ON "operator"."langfuse_eval_backlink_projection" USING btree (
    "eval_run_id", "score_name"
);
