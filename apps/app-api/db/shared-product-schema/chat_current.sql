CREATE SCHEMA IF NOT EXISTS "chat";

CREATE TABLE IF NOT EXISTS "chat"."conversations" (
    "id" text PRIMARY KEY,
    "owner_user_id" text NOT NULL,
    "title" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "archived_at" timestamp with time zone,
    "pinned_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "title_updated_at" timestamp with time zone,
    "active_branch_id" text DEFAULT 'branch_active' NOT NULL,
    "active_message_id" text,
    "active_run_id" text,
    "active_turn_sequence" integer DEFAULT 0 NOT NULL,
    "context_summary" text
);

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_archived_updated_at_idx"
ON "chat"."conversations" USING btree ("owner_user_id", "archived_at", "updated_at");

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_deleted_updated_at_idx"
ON "chat"."conversations" USING btree ("owner_user_id", "deleted_at", "updated_at");

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_pinned_updated_at_idx"
ON "chat"."conversations" USING btree ("owner_user_id", "pinned_at", "updated_at");

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_updated_at_idx"
ON "chat"."conversations" USING btree ("owner_user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "chat"."messages" (
    "id" text PRIMARY KEY,
    "conversation_id" text NOT NULL REFERENCES "chat"."conversations" ("id") ON DELETE CASCADE,
    "role" text NOT NULL,
    "kind" text,
    "text" text NOT NULL,
    "structured_parts_json" jsonb,
    "created_at" timestamp with time zone NOT NULL,
    "request_id" text,
    "retryable" boolean,
    "parent_message_id" text,
    "branch_id" text DEFAULT 'branch_active' NOT NULL,
    "turn_sequence" integer DEFAULT 0 NOT NULL,
    "run_id" text,
    "is_active_branch_head" boolean DEFAULT false NOT NULL
);

CREATE INDEX IF NOT EXISTS "chat_messages_conversation_created_at_idx"
ON "chat"."messages" USING btree ("conversation_id", "created_at");

CREATE INDEX IF NOT EXISTS "chat_messages_conversation_branch_sequence_idx"
ON "chat"."messages" USING btree ("conversation_id", "branch_id", "turn_sequence");

CREATE INDEX IF NOT EXISTS "chat_messages_request_id_idx"
ON "chat"."messages" USING btree ("request_id");

CREATE INDEX IF NOT EXISTS "chat_messages_run_id_idx"
ON "chat"."messages" USING btree ("run_id");

CREATE TABLE IF NOT EXISTS "chat"."turn_dispatches" (
    "request_id" text PRIMARY KEY,
    "conversation_id" text NOT NULL REFERENCES "chat"."conversations" ("id") ON DELETE CASCADE,
    "user_message_id" text NOT NULL REFERENCES "chat"."messages" ("id") ON DELETE CASCADE,
    "assistant_message_id" text NOT NULL,
    "turn_sequence" integer NOT NULL,
    "surface" text NOT NULL,
    "owner_user_id" text NOT NULL,
    "actor_user_id" text NOT NULL,
    "principal_snapshot_json" jsonb NOT NULL,
    "memory_recall_enabled" boolean,
    "memory_append_enabled" boolean,
    "memory_owner_generation" bigint,
    "memory_owner_sequence" bigint,
    "idempotency_key" text,
    "request_fingerprint_sha256" text,
    "trace_id" text NOT NULL,
    "run_id" text,
    "admission_status" text DEFAULT 'pending_admission' NOT NULL,
    "workflow_id" text,
    "admission_input_json" text,
    "admission_input_sha256" text,
    "execution_input_json" text,
    "execution_input_sha256" text,
    "execution_input_released_at" timestamp with time zone,
    "admitted_at" timestamp with time zone,
    "cancel_outbox_status" text DEFAULT 'not_requested' NOT NULL,
    "cancel_reason" text,
    "cancel_requested_at" timestamp with time zone,
    "cancel_attempt_count" integer DEFAULT 0 NOT NULL,
    "cancel_last_attempt_at" timestamp with time zone,
    "cancel_last_error_code" text,
    "cancel_delivered_at" timestamp with time zone,
    "finalization_fingerprint" text,
    "safety_identifier" text,
    "status" text NOT NULL,
    "error_code" text,
    "created_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_recall_enabled" boolean;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_append_enabled" boolean;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_owner_generation" bigint;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "memory_owner_sequence" bigint;
LOCK TABLE "chat"."turn_dispatches" IN ACCESS EXCLUSIVE MODE;
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
            'agent runtime schema migration requires all legacy chat runs to be in a contract terminal status';
    END IF;
END
$$;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "assistant_message_id" text;
UPDATE "chat"."turn_dispatches"
SET "assistant_message_id" = "request_id" || ':assistant'
WHERE "assistant_message_id" IS null;
ALTER TABLE "chat"."turn_dispatches" ALTER COLUMN "assistant_message_id" SET NOT NULL;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "admission_status" text DEFAULT 'pending_admission' NOT NULL;
ALTER TABLE "chat"."turn_dispatches"
ALTER COLUMN "admission_status" SET DEFAULT 'pending_admission';
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "workflow_id" text;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "admission_input_json" text;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "admission_input_sha256" text;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "execution_input_json" text;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "execution_input_sha256" text;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "execution_input_released_at" timestamp with time zone;
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
$$;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "admitted_at" timestamp with time zone;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "cancel_outbox_status" text DEFAULT 'not_requested' NOT NULL;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp with time zone;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "cancel_attempt_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "cancel_last_attempt_at" timestamp with time zone;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "cancel_last_error_code" text;
ALTER TABLE "chat"."turn_dispatches"
ADD COLUMN IF NOT EXISTS "cancel_delivered_at" timestamp with time zone;
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "finalization_fingerprint" text;
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
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "chat_turn_dispatches_actor_idempotency_uidx"
ON "chat"."turn_dispatches" USING btree ("actor_user_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_conversation_turn_sequence_idx"
ON "chat"."turn_dispatches" USING btree ("conversation_id", "turn_sequence");

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_created_at_request_id_idx"
ON "chat"."turn_dispatches" USING btree ("created_at" DESC, "request_id" DESC);

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_cancel_outbox_idx"
ON "chat"."turn_dispatches" USING btree ("cancel_outbox_status", "updated_at");

DROP INDEX IF EXISTS "chat"."chat_turn_dispatches_run_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "chat_turn_dispatches_run_id_uidx"
ON "chat"."turn_dispatches" USING btree ("run_id")
WHERE "run_id" IS NOT null;

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_safety_identifier_created_at_idx"
ON "chat"."turn_dispatches" USING btree ("safety_identifier", "created_at");

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_status_created_at_idx"
ON "chat"."turn_dispatches" USING btree ("status", "created_at");

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_trace_id_created_at_idx"
ON "chat"."turn_dispatches" USING btree ("trace_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "chat"."message_feedback" (
    "feedback_id" text PRIMARY KEY,
    "owner_user_id" text NOT NULL,
    "conversation_id" text NOT NULL REFERENCES "chat"."conversations" ("id") ON DELETE CASCADE,
    "message_id" text NOT NULL REFERENCES "chat"."messages" ("id") ON DELETE CASCADE,
    "request_id" text NOT NULL,
    "vote" text NOT NULL,
    "reason_codes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_feedback_owner_message_uidx"
ON "chat"."message_feedback" USING btree ("owner_user_id", "message_id");

CREATE INDEX IF NOT EXISTS "chat_message_feedback_request_id_idx"
ON "chat"."message_feedback" USING btree ("request_id");

CREATE INDEX IF NOT EXISTS "chat_message_feedback_updated_at_idx"
ON "chat"."message_feedback" USING btree ("updated_at");

CREATE TABLE IF NOT EXISTS "chat"."session_slots" (
    "conversation_id" text NOT NULL REFERENCES "chat"."conversations" ("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "value" text NOT NULL,
    "confirmed" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "chat_session_slots_conversation_name_idx"
ON "chat"."session_slots" USING btree ("conversation_id", "name");
