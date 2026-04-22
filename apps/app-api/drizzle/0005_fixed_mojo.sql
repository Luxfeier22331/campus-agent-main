CREATE TABLE "operator"."metric_rollup" (
    "rollup_id" text PRIMARY KEY NOT NULL,
    "request_id" text NOT NULL,
    "domain" text NOT NULL,
    "granularity" text NOT NULL,
    "bucket_start" timestamp with time zone NOT NULL,
    "bucket_end" timestamp with time zone NOT NULL,
    "surface" text NOT NULL,
    "selected_target" text,
    "requested_capability" text,
    "principal_type" text NOT NULL,
    "collection" text,
    "model_name" text,
    "metrics_json" jsonb NOT NULL,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."quality_badcase_projection" (
    "badcase_id" text PRIMARY KEY NOT NULL,
    "request_id" text NOT NULL,
    "trace_id" text NOT NULL,
    "surface" text NOT NULL,
    "selected_target" text,
    "status" text NOT NULL,
    "cause_class" text NOT NULL,
    "detected_by" text NOT NULL,
    "opened_at" timestamp with time zone NOT NULL,
    "summary" text NOT NULL,
    "grade_json" jsonb,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "operator_metric_rollup_domain_granularity_bucket_idx"
ON "operator"."metric_rollup" USING btree (
    "domain", "granularity", "bucket_start"
);
--> statement-breakpoint
CREATE INDEX "operator_metric_rollup_request_granularity_bucket_idx"
ON "operator"."metric_rollup" USING btree (
    "request_id", "granularity", "bucket_start"
);
--> statement-breakpoint
CREATE INDEX "operator_metric_rollup_domain_surface_bucket_idx"
ON "operator"."metric_rollup" USING btree (
    "domain", "surface", "bucket_start"
);
--> statement-breakpoint
CREATE INDEX "operator_metric_rollup_domain_target_bucket_idx"
ON "operator"."metric_rollup" USING btree (
    "domain", "selected_target", "bucket_start"
);
--> statement-breakpoint
CREATE INDEX "operator_quality_badcase_projection_status_opened_at_idx"
ON "operator"."quality_badcase_projection" USING btree (
    "status", "opened_at"
);
--> statement-breakpoint
CREATE INDEX "operator_quality_badcase_projection_cause_opened_at_idx"
ON "operator"."quality_badcase_projection" USING btree (
    "cause_class", "opened_at"
);
--> statement-breakpoint
CREATE INDEX "operator_quality_badcase_projection_detected_by_opened_at_idx"
ON "operator"."quality_badcase_projection" USING btree (
    "detected_by", "opened_at"
);
CREATE INDEX "operator_quality_badcase_projection_request_opened_at_idx"
ON "operator"."quality_badcase_projection" USING btree (
    "request_id", "opened_at"
);