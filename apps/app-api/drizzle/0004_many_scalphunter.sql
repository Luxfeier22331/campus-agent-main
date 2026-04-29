CREATE TABLE "operator"."request_audit_projection" (
    "audit_event_id" text PRIMARY KEY NOT NULL,
    "request_id" text NOT NULL,
    "trace_id" text NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "event_type" text NOT NULL,
    "surface" text NOT NULL,
    "principal_type" text NOT NULL,
    "entitlement_snapshot_id" text,
    "policy_projection_version" text,
    "requested_capability" text,
    "selected_target" text,
    "status" text NOT NULL,
    "terminal_code" text,
    "summary" text NOT NULL,
    "diagnostics_json" jsonb NOT NULL,
    "projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "operator_request_audit_projection_request_occurred_at_idx"
ON "operator"."request_audit_projection" USING btree (
    "request_id", "occurred_at"
);
--> statement-breakpoint
CREATE INDEX "operator_request_audit_projection_trace_occurred_at_idx"
ON "operator"."request_audit_projection" USING btree (
    "trace_id", "occurred_at"
);
--> statement-breakpoint
CREATE INDEX "operator_request_audit_projection_event_type_occurred_at_idx"
ON "operator"."request_audit_projection" USING btree (
    "event_type", "occurred_at"
);
CREATE INDEX "operator_request_audit_projection_status_occurred_at_idx"
ON "operator"."request_audit_projection" USING btree (
    "status", "occurred_at"
);