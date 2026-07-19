ALTER TABLE ingestion_control.tasks
ADD COLUMN created_by text;

UPDATE ingestion_control.tasks
SET created_by = 'legacy:unknown'
WHERE created_by IS NULL;

ALTER TABLE ingestion_control.tasks
ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE ingestion_control.tasks
ADD COLUMN pipeline_workflow_id text,
ADD COLUMN retry_of_task_id text REFERENCES ingestion_control.tasks (task_id);

ALTER TABLE ingestion_control.tasks
DROP CONSTRAINT tasks_executor_kind_check;

ALTER TABLE ingestion_control.tasks
ADD CONSTRAINT tasks_executor_kind_check
CHECK (executor_kind IN ('source_collector', 'rust_kernel', 'typescript_kernel'));

CREATE INDEX ingestion_tasks_pipeline_idx
ON ingestion_control.tasks (pipeline_workflow_id, updated_at DESC, task_id DESC)
WHERE pipeline_workflow_id IS NOT NULL;

CREATE TABLE ingestion_control.offline_release_streams (
    stream_id text PRIMARY KEY,
    source_channel text NOT NULL,
    source_surface text NOT NULL CHECK (source_surface IN ('notice', 'file_release')),
    corpus text NOT NULL,
    collection text NOT NULL,
    current_release_id text,
    checkpoint_json jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE ingestion_control.offline_releases (
    release_id text PRIMARY KEY,
    stream_id text NOT NULL REFERENCES ingestion_control.offline_release_streams (stream_id),
    previous_release_id text REFERENCES ingestion_control.offline_releases (release_id),
    run_id text NOT NULL,
    workflow_id text NOT NULL,
    workflow_run_id text NOT NULL,
    manifest_ref_json jsonb NOT NULL,
    item_count integer NOT NULL CHECK (item_count >= 0),
    committed_at timestamptz NOT NULL,
    UNIQUE (stream_id, run_id)
);

ALTER TABLE ingestion_control.offline_release_streams
ADD CONSTRAINT offline_release_streams_current_release_fk
FOREIGN KEY (current_release_id)
REFERENCES ingestion_control.offline_releases (release_id);

CREATE INDEX ingestion_offline_releases_stream_idx
ON ingestion_control.offline_releases (stream_id, committed_at DESC, release_id DESC);
