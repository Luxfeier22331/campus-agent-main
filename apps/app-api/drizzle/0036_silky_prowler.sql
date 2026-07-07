CREATE SCHEMA IF NOT EXISTS "campus_services_ops";
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."audit_events" (
    "audit_event_id" text PRIMARY KEY NOT NULL,
    "action" text NOT NULL,
    "object_type" text NOT NULL,
    "object_id" text NOT NULL,
    "summary" text NOT NULL,
    "before_json" jsonb,
    "after_json" jsonb,
    "actor_json" jsonb NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."releases" (
    "release_id" text PRIMARY KEY NOT NULL,
    "status" text NOT NULL,
    "notes" text,
    "item_count" integer NOT NULL,
    "current_effective_json" jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "created_by_json" jsonb NOT NULL,
    "published_at" timestamp with time zone NOT NULL,
    "published_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."source_attestations" (
    "attestation_id" text PRIMARY KEY NOT NULL,
    "source_type" text NOT NULL,
    "summary" text NOT NULL,
    "operator_notes" text,
    "confirmed_at" timestamp with time zone NOT NULL,
    "status" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "created_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."status_overrides" (
    "override_id" text PRIMARY KEY NOT NULL,
    "service_id" text NOT NULL,
    "display_name" text NOT NULL,
    "status" text NOT NULL,
    "message" text NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_until" timestamp with time zone NOT NULL,
    "source_attestation_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "review_state" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "created_by_json" jsonb NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_services_ops"."transport_overrides" (
    "override_id" text PRIMARY KEY NOT NULL,
    "route_id" text NOT NULL,
    "display_name" text NOT NULL,
    "service_status" text NOT NULL,
    "message" text NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_until" timestamp with time zone NOT NULL,
    "source_attestation_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "review_state" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "created_by_json" jsonb NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "updated_by_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_audit_action_occurred_idx"
ON "campus_services_ops"."audit_events" USING btree (
    "action", "occurred_at"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_audit_object_occurred_idx"
ON "campus_services_ops"."audit_events" USING btree (
    "object_type", "object_id", "occurred_at"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_releases_published_at_idx"
ON "campus_services_ops"."releases" USING btree (
    "published_at"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_attestations_confirmed_at_idx"
ON "campus_services_ops"."source_attestations" USING btree (
    "confirmed_at"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_attestations_source_confirmed_idx"
ON "campus_services_ops"."source_attestations" USING btree (
    "source_type", "confirmed_at"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_status_effective_window_idx"
ON "campus_services_ops"."status_overrides" USING btree (
    "effective_from", "effective_until"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_status_review_updated_idx"
ON "campus_services_ops"."status_overrides" USING btree (
    "review_state", "updated_at"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_status_service_updated_idx"
ON "campus_services_ops"."status_overrides" USING btree (
    "service_id", "updated_at"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_effective_window_idx"
ON "campus_services_ops"."transport_overrides" USING btree (
    "effective_from", "effective_until"
);
--> statement-breakpoint
CREATE INDEX "campus_services_ops_transport_review_updated_idx"
ON "campus_services_ops"."transport_overrides" USING btree (
    "review_state", "updated_at"
);
CREATE INDEX "campus_services_ops_transport_route_updated_idx"
ON "campus_services_ops"."transport_overrides" USING btree (
    "route_id", "updated_at"
);
