-- Personal-memory hard cut: stop memory workers and erase the old Hindsight banks before applying.
-- Preserve account/chat data; retired command payloads cannot be replayed as v3.
DELETE FROM "profile"."memory_command_sources";
--> statement-breakpoint
DELETE FROM "profile"."memory_commands";
--> statement-breakpoint
UPDATE "profile"."memory_settings"
SET
    lifecycle_state = 'erased',
    sync_status = 'synced',
    erased_at = now(),
    updated_at = now();
--> statement-breakpoint
DROP TABLE "profile"."memory_command_sources";
--> statement-breakpoint
DROP TABLE "profile"."memory_items";
--> statement-breakpoint
ALTER TABLE "profile"."memory_commands"
DROP CONSTRAINT "profile_memory_commands_item_snapshot_pair_check";
--> statement-breakpoint
ALTER TABLE "profile"."memory_commands" ADD COLUMN "payload" jsonb;
--> statement-breakpoint
ALTER TABLE "profile"."memory_commands" DROP COLUMN "subject_revision";
--> statement-breakpoint
ALTER TABLE "profile"."memory_commands" DROP COLUMN "accepted_item_key";
--> statement-breakpoint
ALTER TABLE "profile"."memory_commands" DROP COLUMN "accepted_item_value";
--> statement-breakpoint
ALTER TABLE execution_control.personal_memory_call_leases
DROP COLUMN owner_sequence;
--> statement-breakpoint
ALTER TABLE execution_control.personal_memory_call_leases
DROP COLUMN subject_scope_hash;
--> statement-breakpoint
ALTER TABLE chat.turn_dispatches
DROP COLUMN memory_owner_sequence;
