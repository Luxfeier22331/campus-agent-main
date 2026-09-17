-- Account deletion removes all recoverable member identities, including the
-- last modifier of retained reviews. Content cleanup uses the existing app role.
ALTER TABLE dining.reviews ALTER COLUMN updated_by DROP NOT NULL;

-- Unbound uploads stay attributable until acceptance can transfer their cleanup.
ALTER TABLE dining.submission_photos ADD COLUMN upload_owner_id text;

GRANT DELETE ON TABLE dining.reviews TO app_api;
GRANT DELETE ON TABLE dining.review_reports TO app_api;
GRANT UPDATE (details, reporter_user_id, resolved_by) ON TABLE dining.review_reports TO app_api;
GRANT DELETE ON TABLE dining.review_edits TO app_api;
GRANT SELECT (edit_id, review_id, edited_at, expires_at, edited_by)
ON TABLE dining.review_edits TO app_api;
GRANT UPDATE (edited_by) ON TABLE dining.review_edits TO app_api;
