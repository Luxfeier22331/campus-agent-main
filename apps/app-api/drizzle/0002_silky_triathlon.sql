ALTER TABLE "runtime"."request_execution" ADD COLUMN "entitlement_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_execution" ADD COLUMN "entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime"."request_execution" ADD COLUMN "visibility_scope" text;--> statement-breakpoint
ALTER TABLE "runtime"."request_execution" ADD COLUMN "applicability_scope" text;--> statement-breakpoint
ALTER TABLE "operator"."request_projection" ADD COLUMN "entitlement_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "operator"."request_projection" ADD COLUMN "entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "operator"."request_projection" ADD COLUMN "visibility_scope" text;--> statement-breakpoint
ALTER TABLE "operator"."request_projection" ADD COLUMN "applicability_scope" text;