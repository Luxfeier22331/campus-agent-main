CREATE SCHEMA notices AUTHORIZATION campus_agent;

CREATE TABLE notices.schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notices.notice_types (
    notice_type integer PRIMARY KEY,
    name text NOT NULL CHECK (name <> '')
);

CREATE TABLE notices.organizations (
    organization_id text PRIMARY KEY,
    name text NOT NULL CHECK (name <> '')
);

CREATE TABLE notices.domains (
    domain text PRIMARY KEY
);

CREATE TABLE notices.notices (
    notice_id bigint PRIMARY KEY,
    notice_type integer NOT NULL REFERENCES notices.notice_types (notice_type),
    organization_id text REFERENCES notices.organizations (organization_id),
    title text NOT NULL CHECK (title <> ''),
    released_at timestamptz NOT NULL,
    is_external boolean NOT NULL,
    external_url text,
    domain text NOT NULL REFERENCES notices.domains (domain),
    content_html text,
    content_text text,
    CHECK ((is_external AND external_url IS NOT NULL) OR (NOT is_external AND external_url IS NULL))
);

CREATE TABLE notices.notice_assets (
    notice_id bigint NOT NULL REFERENCES notices.notices (notice_id) ON DELETE CASCADE,
    asset_kind text NOT NULL CHECK (asset_kind IN ('image', 'attachment')),
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    original_name text,
    content_type text NOT NULL CHECK (content_type <> ''),
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (notice_id, asset_kind, ordinal)
);

CREATE INDEX notices_released_idx ON notices.notices (released_at DESC, notice_id DESC);
CREATE INDEX notices_domain_released_idx ON notices.notices (
    domain, released_at DESC, notice_id DESC
);
CREATE INDEX notices_type_released_idx ON notices.notices (
    notice_type, released_at DESC, notice_id DESC
);
CREATE INDEX notices_organization_released_idx ON notices.notices (
    organization_id, released_at DESC, notice_id DESC
);

INSERT INTO notices.domains (domain) VALUES
('academic_information'), ('teaching_affairs'), ('academic_achievement'),
('campus_news'), ('student_support'), ('student_development'),
('discipline_competition'), ('admissions'), ('international_programs'),
('employment'), ('campus_operations'), ('human_resources'),
('external_cooperation'), ('procurement'), ('governance'),
('culture_sports'), ('unclassified');

INSERT INTO notices.schema_migrations (version) VALUES (1);

REVOKE ALL ON SCHEMA notices FROM public;
REVOKE ALL ON ALL TABLES IN SCHEMA notices FROM public;

DO $notices_publisher_role$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA notices TO notice_publisher';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA notices TO notice_publisher';
    END IF;
END
$notices_publisher_role$;
