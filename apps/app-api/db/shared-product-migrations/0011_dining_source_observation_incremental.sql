CREATE TABLE IF NOT EXISTS "dining"."source_sync_runs" (
    "run_id" text PRIMARY KEY NOT NULL,
    "source_type" text NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "status" text NOT NULL,
    "total_count" integer NOT NULL,
    "accepted_count" integer NOT NULL,
    "blocked_count" integer NOT NULL,
    "stale_count" integer DEFAULT 0 NOT NULL,
    "error_message" text
);

ALTER TABLE "dining"."source_observations"
ADD COLUMN IF NOT EXISTS "source_base_token" text,
ADD COLUMN IF NOT EXISTS "source_table_id" text,
ADD COLUMN IF NOT EXISTS "source_record_id" text,
ADD COLUMN IF NOT EXISTS "content_hash" text,
ADD COLUMN IF NOT EXISTS "first_seen_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "last_seen_run_id" text,
ADD COLUMN IF NOT EXISTS "stale_at" timestamp with time zone;

UPDATE "dining"."source_observations"
SET
    "content_hash" = COALESCE(
        "content_hash",
        'legacy:' || "observation_id"
    ),
    "first_seen_at" = COALESCE("first_seen_at", "observed_at"),
    "last_seen_at" = COALESCE("last_seen_at", "observed_at"),
    "last_seen_run_id" = COALESCE(
        "last_seen_run_id",
        'legacy:' || "source_type"
    );

ALTER TABLE "dining"."source_observations"
ALTER COLUMN "content_hash" SET NOT NULL,
ALTER COLUMN "first_seen_at" SET NOT NULL,
ALTER COLUMN "last_seen_at" SET NOT NULL,
ALTER COLUMN "last_seen_run_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "dining_source_observations_source_record_idx"
ON "dining"."source_observations" USING btree (
    "source_type", "source_table_id", "source_record_id"
);

CREATE INDEX IF NOT EXISTS "dining_source_observations_stale_idx"
ON "dining"."source_observations" USING btree (
    "source_type", "stale_at"
);

CREATE INDEX IF NOT EXISTS "dining_source_sync_runs_source_started_idx"
ON "dining"."source_sync_runs" USING btree (
    "source_type", "started_at"
);

CREATE INDEX IF NOT EXISTS "dining_source_sync_runs_status_started_idx"
ON "dining"."source_sync_runs" USING btree (
    "status", "started_at"
);
