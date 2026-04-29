CREATE SCHEMA IF NOT EXISTS "profile";
--> statement-breakpoint
CREATE TABLE "profile"."memory_items" (
    "item_id" text PRIMARY KEY NOT NULL,
    "owner_user_id" text NOT NULL,
    "key" text NOT NULL,
    "value" text NOT NULL,
    "source_type" text DEFAULT 'user_declared' NOT NULL,
    "confidence" text DEFAULT 'low' NOT NULL,
    "visibility" text DEFAULT 'user_visible' NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "last_verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile"."memory_settings" (
    "owner_user_id" text PRIMARY KEY NOT NULL,
    "profile_memory_enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profile_memory_items_owner_key_uidx"
ON "profile"."memory_items" USING btree ("owner_user_id", "key");
--> statement-breakpoint
CREATE INDEX "profile_memory_items_owner_updated_at_idx"
ON "profile"."memory_items" USING btree ("owner_user_id", "updated_at");
