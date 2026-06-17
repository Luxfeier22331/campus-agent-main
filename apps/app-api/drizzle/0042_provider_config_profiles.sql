CREATE SCHEMA IF NOT EXISTS "provider_config";
--> statement-breakpoint
CREATE TABLE "provider_config"."profiles" (
    "profile_id" text PRIMARY KEY NOT NULL,
    "kind" text NOT NULL,
    "role" text NOT NULL,
    "provider" text NOT NULL,
    "transport" text NOT NULL,
    "base_url" text NOT NULL,
    "model" text NOT NULL,
    "dimensions" integer,
    "timeout_ms" integer NOT NULL,
    "api_key_secret_json" jsonb NOT NULL,
    "status" text NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "revision" integer NOT NULL,
    "validation_json" jsonb,
    "created_at" timestamp with time zone NOT NULL,
    "created_by_json" jsonb NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_config_profiles_active_role_idx"
ON "provider_config"."profiles" USING btree (
    "role", "active", "updated_at"
);
--> statement-breakpoint
CREATE INDEX "provider_config_profiles_kind_role_updated_idx"
ON "provider_config"."profiles" USING btree (
    "kind", "role", "updated_at"
);
