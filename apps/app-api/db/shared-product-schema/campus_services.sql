CREATE SCHEMA IF NOT EXISTS "campus_services";

CREATE TABLE IF NOT EXISTS "campus_services"."transport_releases" (
    "release_id" text PRIMARY KEY,
    "published_at" timestamp with time zone NOT NULL,
    "effective_from" date NOT NULL,
    "effective_until" date,
    "source_urls_json" jsonb NOT NULL,
    "status_json" jsonb NOT NULL,
    "content_sha256" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "campus_services_transport_releases_content_uidx"
ON "campus_services"."transport_releases" USING btree ("content_sha256");

CREATE INDEX IF NOT EXISTS "campus_services_transport_releases_published_idx"
ON "campus_services"."transport_releases" USING btree ("published_at");

CREATE TABLE IF NOT EXISTS "campus_services"."transport_current" (
    "pointer_key" text PRIMARY KEY,
    "release_id" text NOT NULL REFERENCES "campus_services"."transport_releases" ("release_id"),
    "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "campus_services"."transport_routes" (
    "release_id" text NOT NULL REFERENCES "campus_services"."transport_releases" ("release_id"),
    "route_id" text NOT NULL,
    "display_name" text NOT NULL,
    "origin_campus" text NOT NULL,
    "destination_campus" text NOT NULL,
    "origin_stop_id" text NOT NULL,
    "origin_stop_name" text NOT NULL,
    "destination_stop_id" text NOT NULL,
    "destination_stop_name" text NOT NULL,
    "aliases_json" jsonb NOT NULL,
    "sort_order" integer NOT NULL,
    PRIMARY KEY ("release_id", "route_id")
);

CREATE INDEX IF NOT EXISTS "campus_services_transport_routes_release_sort_idx"
ON "campus_services"."transport_routes" USING btree ("release_id", "sort_order");

CREATE TABLE IF NOT EXISTS "campus_services"."transport_departures" (
    "release_id" text NOT NULL REFERENCES "campus_services"."transport_releases" ("release_id"),
    "departure_id" text NOT NULL,
    "route_id" text NOT NULL,
    "service_mode" text NOT NULL,
    "service_date" date,
    "effective_from" date NOT NULL,
    "effective_until" date,
    "departure_time" text NOT NULL,
    "departure_kind" text NOT NULL,
    "status" text NOT NULL,
    "note" text,
    "source_urls_json" jsonb NOT NULL,
    "sort_order" integer NOT NULL,
    PRIMARY KEY ("release_id", "departure_id"),
    FOREIGN KEY ("release_id", "route_id")
    REFERENCES "campus_services"."transport_routes" ("release_id", "route_id")
);

CREATE INDEX IF NOT EXISTS "campus_services_transport_departures_route_sort_idx"
ON "campus_services"."transport_departures" USING btree ("release_id", "route_id", "sort_order");
