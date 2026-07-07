DELETE FROM "dining"."review_projections";

ALTER TABLE "dining"."review_projections"
ADD COLUMN IF NOT EXISTS "stall_profile_id" text;

ALTER TABLE "dining"."review_projections"
ADD COLUMN IF NOT EXISTS "window_id" text;

ALTER TABLE "dining"."review_projections"
ALTER COLUMN "stall_profile_id" DROP DEFAULT;

ALTER TABLE "dining"."review_projections"
ALTER COLUMN "stall_profile_id" SET NOT NULL;

ALTER TABLE "dining"."review_projections"
ALTER COLUMN "window_id" DROP DEFAULT;

ALTER TABLE "dining"."review_projections"
ALTER COLUMN "window_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "dining_review_projections_stall_profile_idx"
ON "dining"."review_projections" USING btree ("stall_profile_id");

CREATE INDEX IF NOT EXISTS "dining_review_projections_window_idx"
ON "dining"."review_projections" USING btree ("window_id");
