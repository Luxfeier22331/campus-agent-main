CREATE TABLE IF NOT EXISTS "dining"."review_projections" (
    "review_id" text PRIMARY KEY NOT NULL,
    "source_record_id" text NOT NULL,
    "campus" text NOT NULL,
    "hall_id" text NOT NULL,
    "hall_name" text NOT NULL,
    "stall_name" text NOT NULL,
    "dish_name" text NOT NULL,
    "paid_price_label" text,
    "rating" integer,
    "comment" text,
    "contributor_name" text,
    "images_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "published_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "dining_review_projections_hall_idx"
ON "dining"."review_projections" USING btree ("hall_id");

CREATE INDEX IF NOT EXISTS "dining_review_projections_source_record_idx"
ON "dining"."review_projections" USING btree ("source_record_id");
