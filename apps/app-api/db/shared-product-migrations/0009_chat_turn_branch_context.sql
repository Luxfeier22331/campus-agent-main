ALTER TABLE "chat"."conversations"
ADD COLUMN IF NOT EXISTS "active_branch_id" text NOT NULL DEFAULT 'branch_active',
ADD COLUMN IF NOT EXISTS "active_message_id" text,
ADD COLUMN IF NOT EXISTS "active_run_id" text,
ADD COLUMN IF NOT EXISTS "active_turn_sequence" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "context_summary" text;

ALTER TABLE "chat"."messages"
ADD COLUMN IF NOT EXISTS "parent_message_id" text,
ADD COLUMN IF NOT EXISTS "branch_id" text NOT NULL DEFAULT 'branch_active',
ADD COLUMN IF NOT EXISTS "turn_sequence" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "run_id" text,
ADD COLUMN IF NOT EXISTS "is_active_branch_head" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "chat_messages_conversation_branch_sequence_idx"
ON "chat"."messages" USING btree ("conversation_id", "branch_id", "turn_sequence");

CREATE INDEX IF NOT EXISTS "chat_messages_run_id_idx"
ON "chat"."messages" USING btree ("run_id");
