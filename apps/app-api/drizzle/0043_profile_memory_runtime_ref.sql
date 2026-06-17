ALTER TABLE "profile"."memory_items"
ADD COLUMN "runtime_episode_uuid" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile"."memory_items"
ALTER COLUMN "runtime_episode_uuid" DROP DEFAULT;
