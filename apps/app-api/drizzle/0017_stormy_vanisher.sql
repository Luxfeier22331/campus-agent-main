--> statement-breakpoint
CREATE INDEX "runtime_request_execution_safety_identifier_started_at_idx"
ON "runtime"."request_execution" USING btree (
    "safety_identifier", "started_at"
);
CREATE INDEX "runtime_request_observability_safety_identifier_started_at_idx"
ON "runtime"."request_observability_fact" USING btree (
    "safety_identifier", "started_at"
);