CREATE TABLE IF NOT EXISTS "chat"."message_feedback" (
    feedback_id text PRIMARY KEY NOT NULL,
    owner_user_id text NOT NULL,
    conversation_id text NOT NULL REFERENCES "chat"."conversations" (id) ON DELETE CASCADE,
    message_id text NOT NULL REFERENCES "chat"."messages" (id) ON DELETE CASCADE,
    request_id text NOT NULL,
    vote text NOT NULL,
    reason_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_message_feedback_owner_message_uidx
ON "chat"."message_feedback" (owner_user_id, message_id);

CREATE INDEX IF NOT EXISTS chat_message_feedback_request_id_idx
ON "chat"."message_feedback" (request_id);

CREATE INDEX IF NOT EXISTS chat_message_feedback_updated_at_idx
ON "chat"."message_feedback" (updated_at);
