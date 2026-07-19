ALTER TABLE ingestion_control.offline_release_streams
ADD COLUMN last_check_at timestamptz,
ADD COLUMN last_check_mode text CHECK (last_check_mode IN ('incremental', 'reconcile', 'selected')),
ADD COLUMN last_check_outcome text CHECK (
    last_check_outcome IN ('published', 'unchanged', 'deferred', 'failed')
),
ADD COLUMN last_check_error_code text,
ADD COLUMN last_reconcile_at timestamptz,
ADD COLUMN last_published_at timestamptz,
ADD COLUMN last_added_count integer NOT NULL DEFAULT 0 CHECK (last_added_count >= 0),
ADD COLUMN last_updated_count integer NOT NULL DEFAULT 0 CHECK (last_updated_count >= 0),
ADD COLUMN last_withdrawn_count integer NOT NULL DEFAULT 0 CHECK (last_withdrawn_count >= 0);
