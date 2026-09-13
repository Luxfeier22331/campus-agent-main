CREATE SCHEMA ocr AUTHORIZATION campus_agent;
--> statement-breakpoint
CREATE TABLE ocr.tasks (
    id uuid PRIMARY KEY,
    dedup_key text NOT NULL UNIQUE,
    input jsonb NOT NULL,
    input_sha256 text,
    target jsonb NOT NULL,
    config_updated_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    provider_job_id text,
    progress jsonb,
    error text,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ocr_task_status CHECK (
        status IN ('pending', 'submitting', 'submitted', 'completed', 'failed')
    )
);
--> statement-breakpoint
CREATE INDEX ocr_tasks_runnable ON ocr.tasks (created_at)
WHERE status IN ('pending', 'submitting', 'submitted');
--> statement-breakpoint
GRANT USAGE ON SCHEMA ocr TO ops_web;
GRANT SELECT, INSERT, UPDATE ON ocr.tasks TO ops_web;
--> statement-breakpoint
ALTER TABLE model_config.model_configs DROP CONSTRAINT model_configs_name_check;
ALTER TABLE model_config.model_configs ADD CONSTRAINT model_configs_name_check CHECK (
    name IN (
        'primary_agent', 'campus_docs_embedding', 'campus_docs_reranker',
        'notice_classification', 'document_ocr'
    )
);
