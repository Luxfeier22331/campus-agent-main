ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "selected_tool" text;
ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "tool_business_outcome" text;
ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "tool_fail_close_reason" text;
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "tool_historical_downgrade_reason" text;
ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "workflow_trace_summary_json" jsonb;
