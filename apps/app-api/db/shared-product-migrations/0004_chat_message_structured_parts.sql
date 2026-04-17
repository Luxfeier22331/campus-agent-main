ALTER TABLE "chat"."messages"
ADD COLUMN IF NOT EXISTS structured_parts_json jsonb NULL;
