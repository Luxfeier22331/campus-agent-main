CREATE SCHEMA IF NOT EXISTS "profile";

CREATE TABLE IF NOT EXISTS "profile"."memory_settings" (
    owner_user_id text PRIMARY KEY NOT NULL,
    profile_memory_enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "profile"."memory_items" (
    item_id text PRIMARY KEY NOT NULL,
    owner_user_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    source_type text NOT NULL DEFAULT 'user_declared',
    confidence text NOT NULL DEFAULT 'low',
    visibility text NOT NULL DEFAULT 'user_visible',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    last_verified_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_memory_items_owner_key_uidx
ON "profile"."memory_items" (owner_user_id, key);

CREATE INDEX IF NOT EXISTS profile_memory_items_owner_updated_at_idx
ON "profile"."memory_items" (owner_user_id, updated_at);
