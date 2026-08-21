DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM notices.notices LIMIT 1) THEN
        RAISE EXCEPTION 'notice category migration requires an empty notices projection';
    END IF;
END
$$;

DROP INDEX notices.notices_domain_released_idx;

ALTER TABLE notices.notices
DROP COLUMN domain;

DROP TABLE notices.domains;

CREATE TABLE notices.categories (
    category text PRIMARY KEY
);

INSERT INTO notices.categories (category) VALUES
('research_affairs'), ('lectures_forums'), ('teaching_affairs'),
('student_affairs'), ('competitions'), ('admissions'),
('international_programs'), ('employment'), ('campus_operations'),
('human_resources'), ('governance'), ('procurement'),
('campus_activities'), ('campus_news'), ('unclassified');

ALTER TABLE notices.notices
ADD COLUMN category text NOT NULL REFERENCES notices.categories (category);

CREATE INDEX notices_category_released_idx ON notices.notices (
    category, released_at DESC, notice_id DESC
);

DO $notices_publisher_role$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON notices.categories TO notice_publisher';
    END IF;
END
$notices_publisher_role$;

GRANT SELECT ON notices.categories TO app_api;

INSERT INTO notices.schema_migrations (version) VALUES (5);
