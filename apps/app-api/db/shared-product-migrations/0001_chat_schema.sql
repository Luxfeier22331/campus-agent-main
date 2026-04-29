CREATE SCHEMA IF NOT EXISTS "chat";

CREATE TABLE IF NOT EXISTS "chat"."conversations" (
    id text PRIMARY KEY,
    owner_user_id text NOT NULL,
    title text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_updated_idx"
ON "chat"."conversations" (owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS "chat"."messages" (
    id text PRIMARY KEY,
    conversation_id text NOT NULL REFERENCES "chat"."conversations" (id) ON DELETE CASCADE,
    role text NOT NULL,
    kind text NULL,
    text text NOT NULL,
    created_at timestamptz NOT NULL,
    request_id text NULL
);

CREATE INDEX IF NOT EXISTS "chat_messages_conversation_created_idx"
ON "chat"."messages" (conversation_id, created_at ASC);
