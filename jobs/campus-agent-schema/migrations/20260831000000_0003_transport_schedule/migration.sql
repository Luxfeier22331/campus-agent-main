CREATE SCHEMA IF NOT EXISTS transport;

CREATE TABLE transport.routes (
    route_id text PRIMARY KEY,
    origin text NOT NULL,
    destination text NOT NULL,
    service_kind text NOT NULL CHECK (service_kind IN ('commute', 'subway', 'special')),
    default_boarding_point text,
    display_order integer NOT NULL CHECK (display_order >= 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by text NOT NULL
);

CREATE TABLE transport.schedule_periods (
    schedule_id text PRIMARY KEY,
    route_id text NOT NULL REFERENCES transport.routes (route_id) ON DELETE CASCADE,
    valid_from date NOT NULL,
    valid_to date,
    weekdays integer[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7),
    status text NOT NULL CHECK (status IN ('operating', 'suspended')),
    boarding_point_override text,
    note text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by text NOT NULL,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE transport.schedule_items (
    item_id text PRIMARY KEY,
    schedule_id text NOT NULL REFERENCES transport.schedule_periods (schedule_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('fixed', 'interval')),
    boarding_point text,
    departure_time text,
    first_departure_time text,
    last_departure_time text,
    interval_minutes integer,
    rider_type text NOT NULL CHECK (rider_type IN ('student', 'teacher', 'all')),
    capacity integer CHECK (capacity IS NULL OR capacity > 0),
    note text,
    sort_order integer NOT NULL CHECK (sort_order >= 0),
    CHECK (
        (
            kind = 'fixed'
            AND departure_time IS NOT NULL
            AND first_departure_time IS NULL
            AND last_departure_time IS NULL
            AND interval_minutes IS NULL
        )
        OR
        (
            kind = 'interval'
            AND departure_time IS NULL
            AND first_departure_time IS NOT NULL
            AND last_departure_time IS NOT NULL
            AND interval_minutes IS NOT NULL
            AND interval_minutes > 0
        )
    ),
    CHECK (
        (
            departure_time IS NULL
            OR departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        )
        AND (
            first_departure_time IS NULL
            OR first_departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        )
        AND (
            last_departure_time IS NULL
            OR last_departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        )
    )
);

CREATE INDEX transport_routes_display_idx ON transport.routes (display_order, route_id);
CREATE INDEX transport_schedule_periods_route_date_idx
ON transport.schedule_periods (route_id, valid_from, valid_to, updated_at);
CREATE INDEX transport_schedule_items_schedule_sort_idx
ON transport.schedule_items (schedule_id, sort_order, item_id);
GRANT USAGE ON SCHEMA transport TO app_api, ops_web;
GRANT SELECT ON transport.routes, transport.schedule_periods, transport.schedule_items TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON transport.routes,
transport.schedule_periods, transport.schedule_items TO ops_web;
