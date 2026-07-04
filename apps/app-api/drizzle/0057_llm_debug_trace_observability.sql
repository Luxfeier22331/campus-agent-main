CREATE SCHEMA IF NOT EXISTS "observability_config";
--> statement-breakpoint
CREATE TABLE "observability_config"."llm_debug_trace_config" (
	"config_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"include_model_io" boolean DEFAULT false NOT NULL,
	"sample_ratio" numeric DEFAULT '1' NOT NULL,
	"otlp_endpoint" text,
	"public_trace_base_url" text,
	"auth_header_secret_json" jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "stage_timing_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "debug_trace_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
