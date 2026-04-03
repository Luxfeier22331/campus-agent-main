CREATE TABLE IF NOT EXISTS "chat"."session_slots" (
  conversation_id text NOT NULL REFERENCES "chat"."conversations"(id) ON DELETE CASCADE,
  name text NOT NULL,
  value text NOT NULL,
  confirmed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, name)
);

CREATE INDEX IF NOT EXISTS "chat_session_slots_conversation_name_idx"
  ON "chat"."session_slots" (conversation_id, name);
