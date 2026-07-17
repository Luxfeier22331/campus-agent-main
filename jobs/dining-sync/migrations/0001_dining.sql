DROP SCHEMA IF EXISTS dining CASCADE;
CREATE SCHEMA dining;

CREATE TABLE dining.halls (
    hall_id text PRIMARY KEY,
    campus text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE dining.floors (
    floor_id text PRIMARY KEY,
    hall_id text NOT NULL REFERENCES dining.halls (hall_id) ON DELETE CASCADE,
    label text NOT NULL,
    floorplan_kind text NOT NULL CHECK (floorplan_kind IN ('asset', 'placeholder')),
    floorplan_id text NOT NULL,
    sort_key text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX dining_floors_hall_idx ON dining.floors (hall_id);
CREATE TABLE dining.windows (
    window_id text PRIMARY KEY,
    hall_id text NOT NULL REFERENCES dining.halls (hall_id) ON DELETE CASCADE,
    floor_id text NOT NULL REFERENCES dining.floors (floor_id) ON DELETE CASCADE,
    label text NOT NULL,
    location_label text NOT NULL,
    svg_anchor_id text,
    tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (floor_id, svg_anchor_id)
);
CREATE INDEX dining_windows_floor_idx ON dining.windows (hall_id, floor_id);
CREATE TABLE dining.stall_profiles (
    stall_profile_id text PRIMARY KEY,
    display_name text NOT NULL,
    stall_type text NOT NULL,
    tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE dining.window_assignments (
    assignment_id text PRIMARY KEY,
    window_id text NOT NULL UNIQUE REFERENCES dining.windows (window_id) ON DELETE CASCADE,
    stall_profile_id text NOT NULL REFERENCES dining.stall_profiles (stall_profile_id),
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE dining.menu_items (
    menu_item_id text PRIMARY KEY,
    name text NOT NULL,
    tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE dining.menu_offerings (
    offering_id text PRIMARY KEY,
    assignment_id text NOT NULL REFERENCES dining.window_assignments (
        assignment_id
    ) ON DELETE CASCADE,
    menu_item_id text NOT NULL REFERENCES dining.menu_items (menu_item_id),
    price_label text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (assignment_id, menu_item_id)
);
CREATE INDEX dining_offerings_assignment_idx ON dining.menu_offerings (assignment_id);

CREATE TABLE dining.catalog_state (
    scope text PRIMARY KEY CHECK (scope = 'global'),
    draft_revision integer NOT NULL CHECK (draft_revision > 0),
    base_release_id text,
    updated_at timestamptz NOT NULL,
    updated_by text NOT NULL
);
CREATE TABLE dining.releases (
    release_id text PRIMARY KEY,
    predecessor_release_id text REFERENCES dining.releases (release_id) ON DELETE SET NULL,
    rollback_of_release_id text REFERENCES dining.releases (release_id) ON DELETE SET NULL,
    draft_revision integer NOT NULL,
    notes text NOT NULL,
    snapshot_hash text NOT NULL,
    payload_json jsonb NOT NULL,
    validation_json jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    created_by text NOT NULL
);
CREATE INDEX dining_releases_created_idx ON dining.releases (created_at DESC);
ALTER TABLE dining.catalog_state
ADD CONSTRAINT dining_catalog_state_base_release_fk
FOREIGN KEY (base_release_id) REFERENCES dining.releases (release_id);
CREATE TABLE dining.publication (
    scope text PRIMARY KEY CHECK (scope = 'global'),
    catalog_release_id text REFERENCES dining.releases (release_id),
    review_revision integer NOT NULL DEFAULT 0 CHECK (review_revision >= 0),
    updated_at timestamptz NOT NULL
);

CREATE TABLE dining.source_sync_runs (
    run_id text PRIMARY KEY,
    source_type text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    status text NOT NULL,
    total_count integer NOT NULL,
    accepted_count integer NOT NULL,
    blocked_count integer NOT NULL,
    stale_count integer NOT NULL DEFAULT 0,
    error_message text
);
CREATE INDEX dining_sync_runs_started_idx ON dining.source_sync_runs (source_type, started_at DESC);
CREATE TABLE dining.source_observations (
    observation_id text PRIMARY KEY,
    source_type text NOT NULL,
    source_base_token text,
    source_table_id text,
    source_record_id text,
    target_kind text NOT NULL,
    target_id text,
    payload_json jsonb NOT NULL,
    content_hash text NOT NULL,
    status text NOT NULL,
    observed_at timestamptz NOT NULL,
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    last_seen_run_id text NOT NULL REFERENCES dining.source_sync_runs (run_id),
    stale_at timestamptz
);
CREATE INDEX dining_observations_source_idx
ON dining.source_observations (source_type, status, stale_at);
CREATE TABLE dining.catalog_overrides (
    override_id text PRIMARY KEY,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    patch_json jsonb NOT NULL,
    reason text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by text NOT NULL
);
CREATE INDEX dining_catalog_overrides_target_idx
ON dining.catalog_overrides (target_kind, target_id) WHERE active;

CREATE TABLE dining.reviews (
    review_id text PRIMARY KEY,
    source_record_id text NOT NULL UNIQUE,
    campus text NOT NULL,
    hall_name text NOT NULL,
    stall_name text NOT NULL,
    dish_name text NOT NULL,
    paid_price_label text,
    rating integer CHECK (rating BETWEEN 1 AND 5),
    comment text,
    contributor_name text,
    images_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    submitted_at timestamptz NOT NULL,
    moderation_status text NOT NULL,
    visibility text NOT NULL,
    hall_id text,
    stall_profile_id text,
    window_id text,
    offering_id text,
    published_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX dining_reviews_offering_idx
ON dining.reviews (offering_id, visibility, submitted_at DESC);
CREATE TABLE dining.review_overrides (
    review_id text PRIMARY KEY REFERENCES dining.reviews (review_id) ON DELETE CASCADE,
    offering_id text,
    visibility text,
    reason text NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by text NOT NULL
);
CREATE TABLE dining.review_recheck_requests (
    request_id text PRIMARY KEY,
    review_id text NOT NULL REFERENCES dining.reviews (review_id) ON DELETE CASCADE,
    status text NOT NULL,
    requested_at timestamptz NOT NULL,
    requested_by text NOT NULL,
    completed_at timestamptz,
    error_message text
);
CREATE INDEX dining_review_recheck_status_idx
ON dining.review_recheck_requests (status, requested_at);

CREATE TABLE dining.operation_events (
    event_id text PRIMARY KEY,
    action text NOT NULL,
    actor_id text NOT NULL,
    object_kind text NOT NULL,
    object_id text NOT NULL,
    summary_json jsonb NOT NULL,
    occurred_at timestamptz NOT NULL
);
CREATE INDEX dining_operation_events_occurred_idx ON dining.operation_events (occurred_at DESC);

INSERT INTO dining.catalog_state (scope, draft_revision, updated_at, updated_by)
VALUES ('global', 1, now(), 'system:dining-migration');
INSERT INTO dining.publication (scope, review_revision, updated_at)
VALUES ('global', 0, now());

DO $dining_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    GRANT USAGE ON SCHEMA dining TO app_api;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA dining FROM app_api;
    GRANT SELECT ON dining.publication, dining.releases, dining.reviews TO app_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_web_dining') THEN
    GRANT USAGE ON SCHEMA dining TO ops_web_dining;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA dining FROM ops_web_dining;
    GRANT SELECT ON ALL TABLES IN SCHEMA dining TO ops_web_dining;
    GRANT INSERT, UPDATE, DELETE ON
      dining.halls, dining.floors, dining.windows, dining.stall_profiles,
      dining.window_assignments, dining.menu_items, dining.menu_offerings,
      dining.catalog_state, dining.releases, dining.publication,
      dining.catalog_overrides, dining.reviews, dining.review_overrides,
      dining.review_recheck_requests, dining.operation_events
    TO ops_web_dining;
    REVOKE CREATE ON SCHEMA dining FROM ops_web_dining;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dining_sync') THEN
    GRANT USAGE ON SCHEMA dining TO dining_sync;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA dining FROM dining_sync;
    GRANT SELECT ON dining.publication, dining.releases, dining.review_overrides,
      dining.source_observations, dining.review_recheck_requests, dining.reviews
    TO dining_sync;
    GRANT SELECT, INSERT, UPDATE ON dining.source_sync_runs,
      dining.source_observations, dining.reviews, dining.review_recheck_requests,
      dining.publication
    TO dining_sync;
    REVOKE CREATE ON SCHEMA dining FROM dining_sync;
  END IF;
END
$dining_grants$;
