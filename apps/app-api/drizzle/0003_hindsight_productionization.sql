CREATE TABLE "profile"."memory_command_sources" (
	"command_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	CONSTRAINT "memory_command_sources_command_id_source_message_id_pk" PRIMARY KEY("command_id","source_message_id")
);
--> statement-breakpoint
CREATE TABLE "profile"."memory_commands" (
	"command_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_generation" bigint NOT NULL,
	"owner_sequence" bigint NOT NULL,
	"command_kind" text NOT NULL,
	"supersession_scope" text NOT NULL,
	"subject_id" text,
	"subject_revision" bigint,
	"accepted_item_key" text,
	"accepted_item_value" text,
	"accepted_lifecycle_state" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending_admission' NOT NULL,
	"workflow_id" text,
	"admitted_at" timestamp with time zone,
	"last_error_code" text,
	"result_fingerprint" text,
	"reported_result_status" text,
	"idempotency_key_hash" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "profile_memory_commands_supersession_scope_check" CHECK (length("profile"."memory_commands"."supersession_scope") between 1 and 300),
	CONSTRAINT "profile_memory_commands_lifecycle_snapshot_check" CHECK ("profile"."memory_commands"."accepted_lifecycle_state" in ('active', 'paused', 'erasing', 'erased')),
	CONSTRAINT "profile_memory_commands_item_snapshot_pair_check" CHECK (("profile"."memory_commands"."accepted_item_key" is null) = ("profile"."memory_commands"."accepted_item_value" is null)),
	CONSTRAINT "profile_memory_commands_reported_result_status_check" CHECK ("profile"."memory_commands"."reported_result_status" is null or "profile"."memory_commands"."reported_result_status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
DROP TABLE "campus_services_ops"."audit_events" CASCADE;--> statement-breakpoint
DROP TABLE "campus_services_ops"."releases" CASCADE;--> statement-breakpoint
DROP TABLE "campus_services_ops"."source_attestations" CASCADE;--> statement-breakpoint
DROP TABLE "campus_services_ops"."transport_overrides" CASCADE;--> statement-breakpoint
DROP TABLE "identity"."access_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "identity"."accounts" CASCADE;--> statement-breakpoint
DROP TABLE "identity"."federation_claims_policies" CASCADE;--> statement-breakpoint
DROP TABLE "identity"."federation_clients" CASCADE;--> statement-breakpoint
DROP TABLE "identity"."federation_user_grants" CASCADE;--> statement-breakpoint
DROP TABLE "identity"."preference_settings" CASCADE;--> statement-breakpoint
DROP TABLE "identity"."identity_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "observability"."ops_observability_read_audit" CASCADE;--> statement-breakpoint
ALTER TABLE "profile"."memory_items" ADD COLUMN "owner_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_items" ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_items" ADD COLUMN "desired_state" text DEFAULT 'present' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_items" ADD COLUMN "sync_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_items" ADD COLUMN "sync_error_code" text;--> statement-breakpoint
ALTER TABLE "profile"."memory_settings" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_settings" ADD COLUMN "sync_status" text DEFAULT 'synced' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_settings" ADD COLUMN "generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_settings" ADD COLUMN "command_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."memory_settings" ADD COLUMN "erase_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile"."memory_settings" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
UPDATE "profile"."memory_settings"
SET "lifecycle_state" = CASE
	WHEN "profile_memory_enabled" THEN 'active'
	ELSE 'paused'
END;--> statement-breakpoint
ALTER TABLE "profile"."memory_command_sources" ADD CONSTRAINT "memory_command_sources_command_id_memory_commands_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "profile"."memory_commands"("command_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_memory_commands_owner_sequence_uidx" ON "profile"."memory_commands" USING btree ("owner_user_id","owner_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_memory_commands_owner_idempotency_uidx" ON "profile"."memory_commands" USING btree ("owner_user_id","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "profile_memory_commands_status_created_idx" ON "profile"."memory_commands" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "profile_memory_commands_owner_status_sequence_idx" ON "profile"."memory_commands" USING btree ("owner_user_id","status","owner_sequence");--> statement-breakpoint
CREATE INDEX "profile_memory_commands_owner_generation_scope_sequence_idx" ON "profile"."memory_commands" USING btree ("owner_user_id","owner_generation","supersession_scope","owner_sequence");--> statement-breakpoint
ALTER TABLE "profile"."memory_items" DROP COLUMN "runtime_episode_uuid";--> statement-breakpoint
ALTER TABLE "profile"."memory_settings" DROP COLUMN "profile_memory_enabled";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "assistant_message_id" text;--> statement-breakpoint
UPDATE "chat"."turn_dispatches"
SET "assistant_message_id" = "request_id" || ':assistant'
WHERE "assistant_message_id" IS NULL;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ALTER COLUMN "assistant_message_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "admission_status" text DEFAULT 'pending_input' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "workflow_id" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "workflow_input_json" jsonb;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "workflow_input_sha256" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "admitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "finalization_fingerprint" text;--> statement-breakpoint
DROP SCHEMA IF EXISTS "campus_services_ops" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "identity" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "observability" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "official_web" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "operator" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "provider_config" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "wechat_official_account" CASCADE;
