ALTER TABLE notices.notices
ALTER COLUMN category DROP NOT NULL;

ALTER TABLE notices.notices
ADD COLUMN is_published boolean NOT NULL DEFAULT false;

UPDATE notices.notices
SET is_published = true;

ALTER TABLE notices.notices
ADD CONSTRAINT notices_published_category_check
CHECK (NOT is_published OR category IS NOT null);

DO $ops_web_notice_access$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_web') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA notices TO ops_web';
        EXECUTE 'GRANT SELECT ON notices.notice_types, notices.organizations, notices.categories TO ops_web';
        EXECUTE 'GRANT SELECT (notice_id, notice_type, organization_id, title, released_at, is_external, external_url, category, is_published) ON notices.notices TO ops_web';
        EXECUTE 'GRANT UPDATE (category) ON notices.notices TO ops_web';
    END IF;
END
$ops_web_notice_access$;

INSERT INTO notices.schema_migrations (version) VALUES (6);
