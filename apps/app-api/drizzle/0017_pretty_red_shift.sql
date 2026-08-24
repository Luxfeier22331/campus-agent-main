DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "chat"."turn_dispatches"
		WHERE "status" = 'accepted'
	) THEN
		RAISE EXCEPTION
			'USING migration 0017 requires no accepted chat turns; retry after Execution Control has reached a terminal state for every accepted turn';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT "chat_turn_dispatches_cancel_outbox_status_check";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT "chat_turn_dispatches_admission_status_check";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT "chat_turn_dispatches_admission_input_pair_check";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT "chat_turn_dispatches_input_lifecycle_check";--> statement-breakpoint
DROP INDEX "chat"."chat_turn_dispatches_cancel_outbox_idx";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN "turn_id" text;--> statement-breakpoint
UPDATE "chat"."turn_dispatches"
SET
	"run_id" = NULL,
	"execution_input_json" = NULL,
	"execution_input_sha256" = NULL
WHERE "status" IN ('completed', 'error', 'approval_required', 'rejected', 'cancelled')
	AND "turn_id" IS NULL
	AND (
		"run_id" IS NOT NULL
		OR "execution_input_json" IS NOT NULL
		OR "execution_input_sha256" IS NOT NULL
	);--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "admission_status";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "workflow_id";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "admission_input_json";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "admission_input_sha256";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "admitted_at";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "cancel_outbox_status";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "cancel_reason";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "cancel_requested_at";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "cancel_attempt_count";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "cancel_last_attempt_at";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "cancel_last_error_code";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "cancel_delivered_at";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD CONSTRAINT "chat_turn_dispatches_input_lifecycle_check" CHECK ((
					"chat"."turn_dispatches"."status" = 'accepted'
					and "chat"."turn_dispatches"."run_id" is not null
					and "chat"."turn_dispatches"."turn_id" is not null
					and (
						"chat"."turn_dispatches"."execution_input_json" is not null
						and "chat"."turn_dispatches"."execution_input_sha256" is not null
					)
				)
				or (
					"chat"."turn_dispatches"."status" in (
						'completed',
						'error',
						'approval_required',
						'rejected',
						'cancelled'
					)
					and (
						(
							"chat"."turn_dispatches"."run_id" is null
							and "chat"."turn_dispatches"."turn_id" is null
							and "chat"."turn_dispatches"."execution_input_json" is null
							and "chat"."turn_dispatches"."execution_input_sha256" is null
						)
						or (
							"chat"."turn_dispatches"."run_id" is not null
						and "chat"."turn_dispatches"."turn_id" is not null
							and "chat"."turn_dispatches"."execution_input_json" is not null
							and "chat"."turn_dispatches"."execution_input_sha256" is not null
						)
					)
				));
