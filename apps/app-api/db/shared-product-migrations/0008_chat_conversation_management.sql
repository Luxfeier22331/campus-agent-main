ALTER TABLE "chat"."conversations"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "title_updated_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_archived_updated_at_idx"
	ON "chat"."conversations" USING btree ("owner_user_id", "archived_at", "updated_at");

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_deleted_updated_at_idx"
	ON "chat"."conversations" USING btree ("owner_user_id", "deleted_at", "updated_at");

CREATE INDEX IF NOT EXISTS "chat_conversations_owner_pinned_updated_at_idx"
	ON "chat"."conversations" USING btree ("owner_user_id", "pinned_at", "updated_at");
