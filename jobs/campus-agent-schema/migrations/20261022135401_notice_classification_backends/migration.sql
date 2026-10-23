-- Notice classification keeps one credential per backend so switching between
-- the decision model and the LLM never discards a key. The old single row is
-- dropped: its key is encrypted with the row name as AAD and is re-entered
-- after rollout.
DELETE FROM model_config.model_configs WHERE name = 'notice_classification';
ALTER TABLE model_config.model_configs DROP CONSTRAINT model_configs_name_check;
ALTER TABLE model_config.model_configs ADD CONSTRAINT model_configs_name_check CHECK (
    name IN (
        'primary_agent', 'campus_docs_embedding', 'campus_docs_reranker', 'document_ocr',
        'notice_classification_decision', 'notice_classification_llm'
    )
);
--> statement-breakpoint
-- One row per read alias names the credential consumers resolve; no row means
-- the alias is unavailable. Public web search joins as another alias.
CREATE TABLE model_config.config_selections (
    alias text PRIMARY KEY,
    config_name text NOT NULL REFERENCES model_config.model_configs (name),
    updated_at timestamptz NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT config_selections_alias_check CHECK (
        alias = 'notice_classification'
        AND config_name IN ('notice_classification_decision', 'notice_classification_llm')
    )
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE model_config.config_selections TO model_config;
