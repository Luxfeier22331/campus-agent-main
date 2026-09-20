CREATE TABLE notices.processing_failures (
    notice_id bigint NOT NULL REFERENCES notices.notices (notice_id) ON DELETE CASCADE,
    stage text NOT NULL CHECK (stage IN ('classification', 'publication')),
    error_type text NOT NULL,
    raw_error text NOT NULL,
    failed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notice_id, stage)
);
GRANT SELECT, DELETE ON notices.processing_failures TO ops_web;
DO $optional_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON notices.processing_failures TO notice_publisher;
    END IF;
END
$optional_publisher$;
