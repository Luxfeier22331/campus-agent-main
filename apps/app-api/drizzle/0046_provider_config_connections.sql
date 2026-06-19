CREATE TABLE "provider_config"."connections" (
    "connection_id" text PRIMARY KEY NOT NULL,
    "provider" text NOT NULL,
    "base_url" text NOT NULL,
    "capabilities_json" jsonb NOT NULL,
    "capability_config_json" jsonb NOT NULL,
    "api_key_secret_json" jsonb NOT NULL,
    "revision" integer NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "created_by_json" jsonb NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_config_connections_provider_updated_idx"
ON "provider_config"."connections" USING btree (
    "provider", "updated_at"
);
--> statement-breakpoint
ALTER TABLE "provider_config"."profiles"
ADD COLUMN "connection_id" text;
--> statement-breakpoint
INSERT INTO "provider_config"."connections" (
    "connection_id",
    "provider",
    "base_url",
    "capabilities_json",
    "capability_config_json",
    "api_key_secret_json",
    "revision",
    "created_at",
    "created_by_json",
    "updated_at",
    "updated_by_json"
)
SELECT
    'provider_connection_' || regexp_replace("profile_id", '[^a-zA-Z0-9_]+', '_', 'g'),
    "provider",
    "base_url",
    jsonb_build_array("kind"),
    '{}'::jsonb,
    "api_key_secret_json",
    1,
    "created_at",
    "created_by_json",
    "updated_at",
    "updated_by_json"
FROM "provider_config"."profiles";
--> statement-breakpoint
UPDATE "provider_config"."profiles"
SET "connection_id" =
    'provider_connection_' || regexp_replace("profile_id", '[^a-zA-Z0-9_]+', '_', 'g');
--> statement-breakpoint
ALTER TABLE "provider_config"."profiles"
ALTER COLUMN "connection_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_config"."profiles"
ADD CONSTRAINT "provider_config_profiles_connection_id_connections_connection_id_fk"
FOREIGN KEY ("connection_id") REFERENCES "provider_config"."connections"("connection_id")
ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "provider_config"."profiles"
ALTER COLUMN "provider" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_config"."profiles"
ALTER COLUMN "base_url" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_config"."profiles"
ALTER COLUMN "api_key_secret_json" DROP NOT NULL;
