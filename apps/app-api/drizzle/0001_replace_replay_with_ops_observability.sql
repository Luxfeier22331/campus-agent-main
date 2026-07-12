CREATE SCHEMA IF NOT EXISTS "observability";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "observability"."ops_observability_read_audit" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"operator_id" text NOT NULL,
	"operator_principal_class" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"record_count" integer NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"truncated" boolean NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "observability_ops_read_at_idx" ON "observability"."ops_observability_read_audit" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "observability_ops_read_request_at_idx" ON "observability"."ops_observability_read_audit" USING btree ("request_id","read_at");--> statement-breakpoint
DROP TABLE IF EXISTS "observability_config"."llm_debug_trace_config" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "observability"."replay_packet_access_audit" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "observability"."replay_packet_index" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "operator"."trace_backlink_projection" CASCADE;--> statement-breakpoint
ALTER TABLE IF EXISTS "runtime"."request_observability_fact" DROP COLUMN IF EXISTS "debug_trace_refs_json";--> statement-breakpoint
DROP SCHEMA IF EXISTS "observability_config";
