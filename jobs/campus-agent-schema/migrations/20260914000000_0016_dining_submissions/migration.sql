-- Dining user submissions, lifecycle metadata, and dual-target reviews.

CREATE TABLE dining.submissions (
    account_deleting_at timestamp with time zone,
    account_deletion_request_id text,
    author_display_name text,
    author_id text,
    content_revision integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by text,
    created_input_sha256 text,
    created_name text,
    created_photo_action text,
    created_price_text text,
    created_submission_date date NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text,
    expires_at timestamp with time zone,
    hidden_at timestamp with time zone,
    hidden_by text,
    idempotency_key text,
    name text,
    price_text text,
    purged_at timestamp with time zone,
    revision integer NOT NULL,
    status text NOT NULL,
    submission_id text PRIMARY KEY,
    updated_at timestamp with time zone NOT NULL,
    updated_by text,
    window_id text,
    CONSTRAINT dining_submissions_status_check CHECK (status IN ('public', 'hidden', 'deleted', 'expired', 'purged')),
    CONSTRAINT dining_submissions_revision_check CHECK (revision > 0 AND content_revision > 0 AND content_revision <= revision),
    CONSTRAINT dining_submissions_name_check CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT dining_submissions_price_check CHECK (price_text IS NULL OR length(btrim(price_text)) BETWEEN 1 AND 40)
);
CREATE INDEX dining_submissions_window_status_created_idx ON dining.submissions (window_id, status, created_at DESC, submission_id DESC);
CREATE INDEX dining_submissions_author_date_idx ON dining.submissions (author_id, created_submission_date);
CREATE UNIQUE INDEX dining_submissions_author_idempotency_uidx ON dining.submissions (author_id, idempotency_key);

CREATE TABLE dining.submission_photos (
    account_deletion_request_id text,
    cleanup_attempts integer NOT NULL DEFAULT 0,
    cleanup_last_error text,
    cleanup_started_at timestamp with time zone,
    cleanup_status text NOT NULL,
    current boolean NOT NULL,
    expires_at timestamp with time zone,
    height integer NOT NULL,
    object_key text NOT NULL,
    object_version_id text,
    photo_id text PRIMARY KEY,
    retired_at timestamp with time zone,
    submission_id text REFERENCES dining.submissions(submission_id) ON DELETE RESTRICT,
    width integer NOT NULL,
    CONSTRAINT dining_submission_photos_cleanup_status_check CHECK (cleanup_status IN ('pending', 'running', 'completed', 'failed')),
    CONSTRAINT dining_submission_photos_dimensions_check CHECK (width > 0 AND height > 0)
);
CREATE UNIQUE INDEX dining_submission_photos_object_key_uidx ON dining.submission_photos (object_key);
CREATE INDEX dining_submission_photos_submission_current_idx ON dining.submission_photos (submission_id, current);
CREATE INDEX dining_submission_photos_expiry_idx ON dining.submission_photos (expires_at, cleanup_status);

CREATE TABLE dining.submission_edits (
    edited_at timestamp with time zone NOT NULL,
    edited_by text,
    expires_at timestamp with time zone NOT NULL,
    edit_id text PRIMARY KEY,
    next_name text,
    next_photo_id text,
    next_price_text text,
    next_revision integer NOT NULL,
    previous_name text,
    previous_photo_id text,
    previous_price_text text,
    previous_revision integer NOT NULL,
    submission_id text NOT NULL REFERENCES dining.submissions(submission_id) ON DELETE RESTRICT,
    CONSTRAINT dining_submission_edits_revision_check CHECK (next_revision > previous_revision)
);
CREATE UNIQUE INDEX dining_submission_edits_submission_next_uidx ON dining.submission_edits (submission_id, next_revision);

CREATE TABLE dining.submission_reports (
    content_expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    details text,
    reason text NOT NULL,
    report_id text PRIMARY KEY,
    reporter_user_id text,
    resolution text,
    resolved_at timestamp with time zone,
    resolved_by text,
    submission_id text NOT NULL REFERENCES dining.submissions(submission_id) ON DELETE RESTRICT,
    target_revision integer NOT NULL,
    CONSTRAINT dining_submission_reports_reason_check CHECK (reason IN ('spam', 'inappropriate', 'privacy', 'other')),
    CONSTRAINT dining_submission_reports_details_check CHECK (details IS NULL OR length(details) <= 300),
    CONSTRAINT dining_submission_reports_resolution_check CHECK (resolution IS NULL OR resolution IN ('keep', 'hide')),
    CONSTRAINT dining_submission_reports_resolution_state_check CHECK ((resolution IS NULL AND resolved_at IS NULL) OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)
    )
);
CREATE UNIQUE INDEX dining_submission_reports_reporter_uidx ON dining.submission_reports (submission_id, reporter_user_id);
CREATE INDEX dining_submission_reports_pending_idx ON dining.submission_reports (resolved_at, created_at, report_id);

ALTER TABLE dining.reviews
    ALTER COLUMN author_display_name DROP NOT NULL,
    ALTER COLUMN author_id DROP NOT NULL,
    ALTER COLUMN body DROP NOT NULL,
    ALTER COLUMN menu_item_id DROP NOT NULL;
ALTER TABLE dining.reviews ADD COLUMN submission_id text REFERENCES dining.submissions(submission_id) ON DELETE RESTRICT;
ALTER TABLE dining.reviews ADD COLUMN content_revision integer NOT NULL DEFAULT 1;
ALTER TABLE dining.reviews DROP CONSTRAINT IF EXISTS dining_reviews_body_check;
ALTER TABLE dining.reviews ADD CONSTRAINT dining_reviews_body_check CHECK (body IS NULL OR length(btrim(body)) BETWEEN 1 AND 500);
ALTER TABLE dining.reviews ADD CONSTRAINT dining_reviews_target_check CHECK ((menu_item_id IS NULL) <> (submission_id IS NULL));
CREATE INDEX dining_reviews_submission_created_idx ON dining.reviews (submission_id, created_at DESC, review_id DESC);

ALTER TABLE dining.review_reports
    ALTER COLUMN reporter_user_id DROP NOT NULL;
ALTER TABLE dining.review_reports ADD COLUMN content_expires_at timestamp with time zone;
ALTER TABLE dining.review_reports ADD COLUMN target_revision integer;
ALTER TABLE dining.review_reports DROP CONSTRAINT IF EXISTS dining_review_reports_resolution_state_check;
ALTER TABLE dining.review_reports ADD CONSTRAINT dining_review_reports_resolution_state_check CHECK ((resolution IS NULL AND resolved_at IS NULL) OR (resolution IS NOT NULL AND resolved_at IS NOT NULL));

ALTER TABLE dining.review_edits
    ALTER COLUMN edited_by DROP NOT NULL,
    ALTER COLUMN next_body DROP NOT NULL,
    ALTER COLUMN previous_body DROP NOT NULL;
ALTER TABLE dining.review_edits ADD COLUMN next_revision integer;
ALTER TABLE dining.review_edits ADD COLUMN previous_revision integer;
ALTER TABLE dining.review_edits ADD COLUMN expires_at timestamp with time zone;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dining.submissions TO app_api;
GRANT SELECT, UPDATE ON TABLE dining.submissions TO ops_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dining.submission_photos TO app_api;
GRANT SELECT ON TABLE dining.submission_photos TO ops_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dining.submission_edits TO app_api;
GRANT SELECT ON TABLE dining.submission_edits TO ops_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dining.submission_reports TO app_api;
GRANT SELECT, UPDATE ON TABLE dining.submission_reports TO ops_web;
