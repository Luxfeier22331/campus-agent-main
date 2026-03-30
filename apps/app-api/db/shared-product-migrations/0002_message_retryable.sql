ALTER TABLE "chat"."messages"
ADD COLUMN IF NOT EXISTS retryable boolean NULL;
