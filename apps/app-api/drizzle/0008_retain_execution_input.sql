LOCK TABLE "chat"."turn_dispatches" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "chat"."conversations" DROP COLUMN "context_summary";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_recall_enabled" boolean;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_append_enabled" boolean;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_owner_generation" bigint;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_owner_sequence" bigint;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT IF EXISTS "chat_turn_dispatches_input_lifecycle_check";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT IF EXISTS "chat_turn_dispatches_execution_input_release_check";--> statement-breakpoint
DELETE FROM "runtime"."request_observability_fact" AS fact
USING "chat"."turn_dispatches" AS dispatch
WHERE fact."request_id" = dispatch."request_id"
  AND dispatch."run_id" IS NOT NULL
  AND (
    dispatch."execution_input_json" IS NULL
    OR dispatch."execution_input_sha256" IS NULL
  );--> statement-breakpoint
UPDATE "chat"."conversations" AS conversation
SET "active_run_id" = NULL
FROM "chat"."turn_dispatches" AS dispatch
WHERE conversation."active_run_id" = dispatch."run_id"
  AND dispatch."run_id" IS NOT NULL
  AND (
    dispatch."execution_input_json" IS NULL
    OR dispatch."execution_input_sha256" IS NULL
  );--> statement-breakpoint
DELETE FROM "chat"."turn_dispatches" AS dispatch
WHERE dispatch."run_id" IS NOT NULL
  AND (
    dispatch."execution_input_json" IS NULL
    OR dispatch."execution_input_sha256" IS NULL
  );--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "execution_input_released_at";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD CONSTRAINT "chat_turn_dispatches_input_lifecycle_check" CHECK ((
  "status" = 'accepted'
  AND "run_id" IS NOT NULL
  AND "workflow_id" IS NOT NULL
  AND "execution_input_json" IS NOT NULL
  AND "execution_input_sha256" IS NOT NULL
  AND (
    (
      "admission_status" IN ('pending_admission', 'dispatching')
      AND "admission_input_json" IS NOT NULL
      AND "admission_input_sha256" IS NOT NULL
    )
    OR (
      "admission_status" = 'admitted'
      AND "admission_input_json" IS NULL
      AND "admission_input_sha256" IS NULL
    )
    OR (
      "admission_status" = 'cancelled'
      AND "cancel_outbox_status" = 'local_finalization_pending'
      AND "admission_input_json" IS NULL
      AND "admission_input_sha256" IS NULL
    )
  )
) OR (
  "status" IN (
    'completed',
    'needs_clarification',
    'no_answer',
    'error',
    'approval_required',
    'rejected',
    'cancelled'
  )
  AND "admission_input_json" IS NULL
  AND "admission_input_sha256" IS NULL
  AND (
    (
      "run_id" IS NULL
      AND "workflow_id" IS NULL
      AND "execution_input_json" IS NULL
      AND "execution_input_sha256" IS NULL
    )
    OR (
      "run_id" IS NOT NULL
      AND "workflow_id" IS NOT NULL
      AND "execution_input_json" IS NOT NULL
      AND "execution_input_sha256" IS NOT NULL
    )
  )
));--> statement-breakpoint
DROP SCHEMA IF EXISTS "campus_services" CASCADE;
