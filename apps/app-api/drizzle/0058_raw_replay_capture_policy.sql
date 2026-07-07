ALTER TABLE "observability_config"."llm_debug_trace_config"
ADD COLUMN "raw_capture_policy_json" jsonb;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "llm_io_fingerprint_json" jsonb;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "observability";
--> statement-breakpoint
CREATE TABLE "observability"."replay_packet_index" (
	"packet_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"object_ref" text NOT NULL,
	"object_checksum_sha256" text NOT NULL,
	"sensitivity_classification" text NOT NULL,
	"capture_policy_json" jsonb NOT NULL,
	"llm_io_fingerprint_json" jsonb NOT NULL,
	"deletion_linkage_json" jsonb NOT NULL,
	"retention_json" jsonb NOT NULL,
	"access_audit_json" jsonb NOT NULL,
	"evidence_replay_index_json" jsonb NOT NULL,
	"encryption_key_ref" text NOT NULL,
	"approval_ref" text,
	"operator_principal" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deletion_marker_json" jsonb
);
--> statement-breakpoint
CREATE INDEX "observability_replay_packet_request_id_idx" ON "observability"."replay_packet_index" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "observability_replay_packet_run_id_idx" ON "observability"."replay_packet_index" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "observability_replay_packet_trace_id_idx" ON "observability"."replay_packet_index" USING btree ("trace_id");
--> statement-breakpoint
CREATE INDEX "observability_replay_packet_expires_at_idx" ON "observability"."replay_packet_index" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE "observability"."replay_packet_access_audit" (
	"access_id" text PRIMARY KEY NOT NULL,
	"packet_id" text NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"access_kind" text NOT NULL,
	"actor_principal" text NOT NULL,
	"purpose" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "observability_replay_packet_access_actor_occurred_idx" ON "observability"."replay_packet_access_audit" USING btree ("actor_principal","occurred_at");
--> statement-breakpoint
CREATE INDEX "observability_replay_packet_access_packet_occurred_idx" ON "observability"."replay_packet_access_audit" USING btree ("packet_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "observability_replay_packet_access_request_occurred_idx" ON "observability"."replay_packet_access_audit" USING btree ("request_id","occurred_at");
