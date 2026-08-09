ALTER TABLE ingestion_control.tasks
DROP COLUMN error_message;

-- Older task rows accepted free-form error codes. Normalize those rows before
-- enforcing the bounded projection contract below.
UPDATE ingestion_control.tasks
SET error_code = 'legacy_error'
WHERE
    error_code IS NOT NULL
    AND error_code !~ '^[A-Za-z0-9_.:-]{1,80}$';

ALTER TABLE ingestion_control.tasks
ADD CONSTRAINT tasks_status_projection_check
CHECK (
    (
        status = 'completed'
        AND result_ref_json IS NOT NULL
        AND result_contract IS NOT NULL
        AND summary_json IS NOT NULL
        AND error_code IS NULL
    )
    OR (
        status = 'running'
        AND result_ref_json IS NULL
        AND result_contract IS NULL
        AND summary_json IS NULL
        AND error_code IS NULL
    )
    OR (
        status IN ('failed', 'canceled')
        AND result_ref_json IS NULL
        AND result_contract IS NULL
        AND summary_json IS NULL
        AND error_code IS NOT NULL
    )
);

ALTER TABLE ingestion_control.tasks
ADD CONSTRAINT tasks_error_code_format_check
CHECK (
    error_code IS NULL
    OR error_code ~ '^[A-Za-z0-9_.:-]{1,80}$'
);
