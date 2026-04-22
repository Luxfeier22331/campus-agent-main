CREATE TABLE "operator"."quality_grade_projection" (
    "grade_id" text PRIMARY KEY NOT NULL,
    "request_id" text NOT NULL,
    "trace_id" text NOT NULL,
    "surface" text NOT NULL,
    "request_started_at" timestamp with time zone NOT NULL,
    "selected_target" text,
    "requested_capability" text,
    "principal_type" text NOT NULL,
    "collection" text,
    "model_name" text,
    "grade_source" text NOT NULL,
    "grade_domain" text NOT NULL,
    "verdict" text NOT NULL,
    "score_milli" integer,
    "grader_version" text NOT NULL,
    "rationale_summary" text,
    "sampled_at" timestamp with time zone NOT NULL,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."trace_backlink_projection" (
    "request_id" text PRIMARY KEY NOT NULL,
    "trace_id" text NOT NULL,
    "trace_link" text,
    "issue_link" text,
    "issue_fingerprint" text,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_request_started_at_idx"
ON "operator"."quality_grade_projection" USING btree (
    "request_started_at"
);
--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_domain_started_at_idx"
ON "operator"."quality_grade_projection" USING btree (
    "grade_domain", "request_started_at"
);
--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_request_sampled_at_idx"
ON "operator"."quality_grade_projection" USING btree (
    "request_id", "sampled_at"
);
--> statement-breakpoint
CREATE INDEX "operator_quality_grade_projection_domain_surface_started_at_idx"
ON "operator"."quality_grade_projection" USING btree (
    "grade_domain", "surface", "request_started_at"
);
CREATE INDEX "operator_trace_backlink_projection_trace_projected_at_idx"
ON "operator"."trace_backlink_projection" USING btree (
    "trace_id", "projected_at"
);