DROP TABLE ingestion_control.official_web_seed_state;
DROP TABLE ingestion_control.official_web_url_freshness;

ALTER TABLE ingestion_control.offline_release_streams
DROP CONSTRAINT offline_release_streams_last_check_mode_check;

UPDATE ingestion_control.offline_release_streams
SET
    last_check_at = NULL,
    last_check_mode = NULL,
    last_check_outcome = NULL,
    last_check_error_code = NULL,
    last_added_count = 0,
    last_updated_count = 0,
    last_withdrawn_count = 0,
    version = version + 1
WHERE last_check_mode = 'reconcile';

ALTER TABLE ingestion_control.offline_release_streams
DROP COLUMN last_reconcile_at;

ALTER TABLE ingestion_control.offline_release_streams
ADD CONSTRAINT offline_release_streams_last_check_mode_check
CHECK (last_check_mode IN ('incremental', 'selected'));

UPDATE ingestion_control.offline_release_streams
SET current_release_id = NULL
WHERE
    source_channel = 'internal_portal'
    AND source_surface = 'notice';

DELETE FROM ingestion_control.offline_releases
WHERE stream_id IN (
    SELECT stream_id
    FROM ingestion_control.offline_release_streams
    WHERE
        source_channel = 'internal_portal'
        AND source_surface = 'notice'
);

DELETE FROM ingestion_control.offline_release_streams
WHERE
    source_channel = 'internal_portal'
    AND source_surface = 'notice';

ALTER TABLE ingestion_control.offline_release_streams
DROP CONSTRAINT offline_release_streams_source_surface_check;

ALTER TABLE ingestion_control.offline_release_streams
ADD CONSTRAINT offline_release_streams_source_surface_check
CHECK (source_surface = 'file_release');

CREATE TABLE ingestion_control.internal_portal_notice_sync_state (
    site_id text NOT NULL,
    notice_type text NOT NULL,
    incremental_head_id bigint CHECK (incremental_head_id > 0),
    min_captured_id bigint CHECK (min_captured_id > 0),
    max_captured_id bigint CHECK (max_captured_id > 0),
    history_covered_from date,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (site_id, notice_type)
);
