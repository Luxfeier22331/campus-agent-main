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
    "turn_sequence" integer NOT NULL,
    "surface" text NOT NULL,
    "owner_user_id" text NOT NULL,
    "actor_user_id" text NOT NULL,
    "principal_snapshot_json" jsonb NOT NULL,
    "idempotency_key" text,
    "request_fingerprint_sha256" text,
    "trace_id" text NOT NULL,
    "run_id" text,
    "safety_identifier" text,
    "requested_tool" text,
    "resolved_targets_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "selected_tool" text,
    "status" text NOT NULL,
    "error_code" text,
    "created_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_turn_dispatches_actor_idempotency_uidx"
ON "chat"."turn_dispatches" USING btree ("actor_user_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_conversation_turn_sequence_idx"
ON "chat"."turn_dispatches" USING btree ("conversation_id", "turn_sequence");

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_created_at_request_id_idx"
ON "chat"."turn_dispatches" USING btree ("created_at" DESC, "request_id" DESC);

CREATE INDEX IF NOT EXISTS "chat_turn_dispatches_run_id_idx"
ON "chat"."turn_dispatches" USING btree ("run_id");

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
