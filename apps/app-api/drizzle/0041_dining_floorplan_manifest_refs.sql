--> statement-breakpoint
ALTER TABLE "dining"."floors" ADD COLUMN "floorplan_id" text DEFAULT 'floorplan:migrated' NOT NULL;
--> statement-breakpoint
ALTER TABLE "dining"."floors" ADD COLUMN "floorplan_sha256" text DEFAULT 'sha256:migrated' NOT NULL;
ALTER TABLE "dining"."floors" DROP COLUMN "draft_floorplan_asset_id";--> statement-breakpoint
DROP TABLE "dining"."floorplan_assets";--> statement-breakpoint
