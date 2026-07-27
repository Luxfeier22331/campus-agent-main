DELETE FROM ingestion_control.tasks
WHERE
    executor_kind <> 'rust_kernel'
    OR pipeline_workflow_id IS NOT NULL;

DROP INDEX ingestion_control.ingestion_tasks_pipeline_idx;

ALTER TABLE ingestion_control.tasks
DROP COLUMN pipeline_workflow_id;

ALTER TABLE ingestion_control.tasks
DROP CONSTRAINT tasks_executor_kind_check;

ALTER TABLE ingestion_control.tasks
ADD CONSTRAINT tasks_executor_kind_check
CHECK (executor_kind = 'rust_kernel');

DROP TABLE ingestion_control.internal_portal_notice_sync_state;

DROP TABLE
ingestion_control.offline_releases,
ingestion_control.offline_release_streams;
