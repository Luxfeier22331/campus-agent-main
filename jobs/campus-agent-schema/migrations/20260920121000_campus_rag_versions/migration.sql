CREATE TABLE campus_docs_serving.index_versions (
    collection text PRIMARY KEY CHECK (collection ~ '^campus_docs_[a-f0-9]{64}$'),
    docs_embedding_set text NOT NULL CHECK (docs_embedding_set ~ '^sha256:[a-f0-9]{64}$'),
    notice_embedding_set text NOT NULL CHECK (notice_embedding_set ~ '^sha256:[a-f0-9]{64}$'),
    producer text NOT NULL CHECK (producer IN ('manual', 'automatic')),
    producer_run_id text,
    validated boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz,
    retired_at timestamptz
);
ALTER TABLE campus_docs_serving.current_index ADD COLUMN previous_collection text;
GRANT SELECT ON campus_docs_serving.index_versions TO ops_web;
GRANT USAGE ON SCHEMA campus_docs_serving TO ops_web;
GRANT SELECT ON campus_docs_serving.current_index TO ops_web;
GRANT SELECT ON campus_docs_serving.index_versions TO product_data_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON campus_docs_serving.index_versions TO execution_control;
