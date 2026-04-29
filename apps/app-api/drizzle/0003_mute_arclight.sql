CREATE TABLE "runtime"."request_observability_fact" (
    "request_id" text PRIMARY KEY NOT NULL,
    "trace_id" text NOT NULL,
    "conversation_id" text NOT NULL,
    "surface" text NOT NULL,
    "principal_type" text NOT NULL,
    "entitlement_snapshot_id" text,
    "policy_projection_version" text,
    "requested_capability" text,
    "requested_scope_summary" text,
    "collection" text,
    "selected_target" text,
    "status" text NOT NULL,
    "error_code" text,
    "started_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "retrieval_attempted" boolean,
    "candidate_count" integer,
    "retrieved_source_count" integer,
    "empty_recall" boolean,
    "citation_expected" boolean,
    "citation_count" integer,
    "citation_missing" boolean,
    "refusal_class" text,
    "acl_decision" text,
    "acl_anomaly_code" text,
    "fail_closed" boolean,
    "model_provider" text,
    "model_name" text,
    "input_tokens" integer,
    "output_tokens" integer,
    "cached_input_tokens" integer,
    "estimated_cost_microusd" integer,
    "trace_available" boolean DEFAULT false NOT NULL,
    "projection_lag_ms" integer,
    "measured_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "runtime_request_observability_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "started_at"
);
--> statement-breakpoint
CREATE INDEX "runtime_request_observability_status_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "status", "started_at"
);
--> statement-breakpoint
CREATE INDEX "runtime_request_observability_surface_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "surface", "started_at"
);
--> statement-breakpoint
CREATE INDEX "runtime_request_observability_selected_target_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "selected_target", "started_at"
);
--> statement-breakpoint
CREATE INDEX "runtime_request_observability_principal_type_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "principal_type", "started_at"
);
--> statement-breakpoint
CREATE INDEX "runtime_request_observability_model_name_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "model_name", "started_at"
);
CREATE INDEX "runtime_request_observability_collection_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "collection", "started_at"
);