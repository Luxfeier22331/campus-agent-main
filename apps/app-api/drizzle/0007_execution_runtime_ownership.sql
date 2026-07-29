LOCK TABLE "chat"."turn_dispatches" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'chat'
		  AND table_name = 'turn_dispatches'
		  AND column_name = 'workflow_input_json'
	) AND EXISTS (
		SELECT 1
		FROM "chat"."turn_dispatches"
		WHERE "status" NOT IN (
			'completed',
			'needs_clarification',
			'no_answer',
			'error',
			'approval_required',
			'rejected',
			'cancelled'
		)
	) THEN
		RAISE EXCEPTION
			'tool_execution_v3 migration requires all v2 chat runs to be in a contract terminal status';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches"
ALTER COLUMN "admission_status" SET DEFAULT 'pending_admission';--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "admission_input_json" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "admission_input_sha256" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "execution_input_json" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "execution_input_sha256" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "execution_input_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_outbox_status" text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_last_error_code" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_delivered_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'chat'
		  AND table_name = 'turn_dispatches'
		  AND column_name = 'workflow_input_json'
	) THEN
		UPDATE "chat"."turn_dispatches"
		SET "admission_status" = CASE
				WHEN "admission_status" IN ('admitted', 'admission_failed', 'cancelled')
					THEN "admission_status"
				WHEN "status" = 'cancelled'
					THEN 'cancelled'
				ELSE 'admitted'
			END,
			"admission_input_json" = NULL,
			"admission_input_sha256" = NULL,
			"execution_input_json" = NULL,
			"execution_input_sha256" = NULL,
			"execution_input_released_at" = COALESCE("completed_at", "updated_at");
		ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "workflow_input_json";
	END IF;
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'chat'
		  AND table_name = 'turn_dispatches'
		  AND column_name = 'workflow_input_sha256'
	) THEN
		ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "workflow_input_sha256";
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'chat_turn_dispatches_cancel_outbox_status_check'
		  AND conrelid = '"chat"."turn_dispatches"'::regclass
	) THEN
		ALTER TABLE "chat"."turn_dispatches"
		ADD CONSTRAINT "chat_turn_dispatches_cancel_outbox_status_check"
		CHECK ("cancel_outbox_status" IN (
			'not_requested',
			'local_finalization_pending',
			'pending_delivery',
			'delivered',
			'closed'
		));
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'chat_turn_dispatches_admission_status_check'
		  AND conrelid = '"chat"."turn_dispatches"'::regclass
	) THEN
		ALTER TABLE "chat"."turn_dispatches"
		ADD CONSTRAINT "chat_turn_dispatches_admission_status_check"
		CHECK ("admission_status" IN (
			'pending_admission',
			'dispatching',
			'admitted',
			'admission_failed',
			'cancelled'
		));
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'chat_turn_dispatches_admission_input_pair_check'
		  AND conrelid = '"chat"."turn_dispatches"'::regclass
	) THEN
		ALTER TABLE "chat"."turn_dispatches"
		ADD CONSTRAINT "chat_turn_dispatches_admission_input_pair_check"
		CHECK (
			("admission_input_json" IS NULL) = ("admission_input_sha256" IS NULL)
		);
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'chat_turn_dispatches_execution_input_pair_check'
		  AND conrelid = '"chat"."turn_dispatches"'::regclass
	) THEN
		ALTER TABLE "chat"."turn_dispatches"
		ADD CONSTRAINT "chat_turn_dispatches_execution_input_pair_check"
		CHECK (
			("execution_input_json" IS NULL) = ("execution_input_sha256" IS NULL)
		);
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'chat_turn_dispatches_execution_input_release_check'
		  AND conrelid = '"chat"."turn_dispatches"'::regclass
	) THEN
		ALTER TABLE "chat"."turn_dispatches"
		ADD CONSTRAINT "chat_turn_dispatches_execution_input_release_check"
		CHECK (
			"execution_input_released_at" IS NULL
			OR (
				"execution_input_json" IS NULL
				AND "execution_input_sha256" IS NULL
			)
		);
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'chat_turn_dispatches_input_lifecycle_check'
		  AND conrelid = '"chat"."turn_dispatches"'::regclass
	) THEN
		ALTER TABLE "chat"."turn_dispatches"
		ADD CONSTRAINT "chat_turn_dispatches_input_lifecycle_check"
		CHECK (
			(
				"status" = 'accepted'
				AND "run_id" IS NOT NULL
				AND "workflow_id" IS NOT NULL
				AND (
					(
						"admission_status" IN ('pending_admission', 'dispatching')
						AND "admission_input_json" IS NOT NULL
						AND "admission_input_sha256" IS NOT NULL
						AND "execution_input_json" IS NOT NULL
						AND "execution_input_sha256" IS NOT NULL
						AND "execution_input_released_at" IS NULL
					)
					OR (
						"admission_status" = 'admitted'
						AND "admission_input_json" IS NULL
						AND "admission_input_sha256" IS NULL
						AND "execution_input_json" IS NOT NULL
						AND "execution_input_sha256" IS NOT NULL
						AND "execution_input_released_at" IS NULL
					)
					OR (
						"admission_status" = 'cancelled'
						AND "cancel_outbox_status" = 'local_finalization_pending'
						AND "admission_input_json" IS NULL
						AND "admission_input_sha256" IS NULL
						AND "execution_input_json" IS NULL
						AND "execution_input_sha256" IS NULL
						AND "execution_input_released_at" IS NOT NULL
					)
				)
			)
			OR (
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
						"admission_status" = 'admitted'
						AND "execution_input_json" IS NOT NULL
						AND "execution_input_sha256" IS NOT NULL
						AND "execution_input_released_at" IS NULL
					)
					OR (
						"admission_status" IN ('admitted', 'admission_failed', 'cancelled')
						AND "execution_input_json" IS NULL
						AND "execution_input_sha256" IS NULL
						AND "execution_input_released_at" IS NOT NULL
					)
				)
			)
		);
	END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_cancel_outbox_idx"
ON "chat"."turn_dispatches" USING btree ("cancel_outbox_status", "updated_at");--> statement-breakpoint
DROP INDEX IF EXISTS "chat"."chat_turn_dispatches_run_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_turn_dispatches_run_id_uidx"
ON "chat"."turn_dispatches" USING btree ("run_id")
WHERE "run_id" IS NOT NULL;
DROP INDEX IF EXISTS "runtime"."runtime_request_observability_selected_tool_started_at_idx";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN IF EXISTS "requested_tool";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN IF EXISTS "resolved_targets_json";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN IF EXISTS "selected_tool";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "requested_tool";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "resolved_targets_json";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "selected_tool";
