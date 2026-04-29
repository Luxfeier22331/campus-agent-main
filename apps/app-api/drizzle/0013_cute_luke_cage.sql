--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "retrieved_sources_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "runtime"."request_observability_fact"
ADD COLUMN "supporting_sources_json" jsonb DEFAULT '[]'::jsonb NOT NULL;