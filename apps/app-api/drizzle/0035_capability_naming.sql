ALTER TABLE "runtime"."request_execution"
RENAME COLUMN "selected_target" TO "selected_capability";

ALTER TABLE "runtime"."request_observability_fact"
RENAME COLUMN "selected_target" TO "selected_capability";

ALTER INDEX IF EXISTS "runtime"."runtime_request_observability_selected_target_started_at_idx"
RENAME TO "runtime_request_observability_selected_capability_started_at_idx";

ALTER TABLE "operator"."request_projection"
RENAME COLUMN "selected_target" TO "selected_capability";

ALTER TABLE "operator"."request_audit_projection"
RENAME COLUMN "selected_target" TO "selected_capability";

ALTER TABLE "operator"."metric_rollup"
RENAME COLUMN "selected_target" TO "selected_capability";

ALTER INDEX IF EXISTS "operator"."operator_metric_rollup_domain_target_bucket_idx"
RENAME TO "operator_metric_rollup_domain_capability_bucket_idx";

ALTER TABLE "operator"."quality_badcase_projection"
RENAME COLUMN "selected_target" TO "selected_capability";

ALTER TABLE "operator"."quality_grade_projection"
RENAME COLUMN "selected_target" TO "selected_capability";
