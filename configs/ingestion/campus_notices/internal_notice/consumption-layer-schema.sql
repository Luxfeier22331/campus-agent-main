CREATE SCHEMA IF NOT EXISTS ingestion_projection;

CREATE TABLE IF NOT EXISTS ingestion_projection.notice_consumption_projection (
    source_corpus text NOT NULL,
    source_collection text NOT NULL,
    source_notice_id text NOT NULL,
    unit_id text NOT NULL,
    primary_role text NOT NULL,
    target_surface text NOT NULL,
    consumption_status text NOT NULL,
    updated_at timestamptz NOT NULL,
    record jsonb NOT NULL,
    PRIMARY KEY (source_corpus, source_collection, unit_id)
);

CREATE INDEX IF NOT EXISTS notice_consumption_projection_notice_idx
ON ingestion_projection.notice_consumption_projection (
    source_corpus,
    source_collection,
    source_notice_id,
    unit_id
);

CREATE INDEX IF NOT EXISTS notice_consumption_projection_target_idx
ON ingestion_projection.notice_consumption_projection (
    source_corpus,
    source_collection,
    target_surface,
    consumption_status
);

CREATE TABLE IF NOT EXISTS ingestion_projection.internal_notice_read_model (
    source_family text NOT NULL,
    source_corpus text NOT NULL,
    source_collection text NOT NULL,
    source_notice_id text NOT NULL,
    unit_id text NOT NULL,
    primary_role text NOT NULL,
    target_surface text NOT NULL,
    consumption_status text NOT NULL,
    queryable boolean NOT NULL,
    title text NOT NULL,
    published_at text NOT NULL,
    canonical_document_id text NOT NULL,
    canonical_markdown_object_key text NOT NULL,
    body_excerpt text NOT NULL,
    search_text text NOT NULL,
    search_vector tsvector NOT NULL,
    projection_updated_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    record jsonb NOT NULL,
    PRIMARY KEY (source_corpus, source_collection, unit_id)
);

CREATE INDEX IF NOT EXISTS internal_notice_read_model_query_idx
ON ingestion_projection.internal_notice_read_model (
    source_family,
    queryable,
    target_surface,
    published_at DESC
);

CREATE INDEX IF NOT EXISTS internal_notice_read_model_notice_idx
ON ingestion_projection.internal_notice_read_model (source_notice_id);

CREATE INDEX IF NOT EXISTS internal_notice_read_model_role_idx
ON ingestion_projection.internal_notice_read_model (primary_role, queryable);

CREATE INDEX IF NOT EXISTS internal_notice_read_model_search_idx
ON ingestion_projection.internal_notice_read_model USING gin (search_vector);

CREATE TABLE IF NOT EXISTS ingestion_projection.internal_notice_consumption_admission (
    batch_id text PRIMARY KEY,
    source_corpus text NOT NULL,
    source_collection text NOT NULL,
    command text NOT NULL,
    selected_notice_ids text [] NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    error text NOT NULL DEFAULT '',
    result_counts jsonb NOT NULL,
    selection_source text NOT NULL DEFAULT '',
    selection_path text NOT NULL DEFAULT '',
    selection_sha256 text NOT NULL DEFAULT '',
    command_args jsonb NOT NULL DEFAULT '{}'::jsonb,
    record jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS internal_notice_consumption_admission_scope_idx
ON ingestion_projection.internal_notice_consumption_admission (
    source_corpus,
    source_collection,
    created_at
);

CREATE INDEX IF NOT EXISTS internal_notice_consumption_admission_command_idx
ON ingestion_projection.internal_notice_consumption_admission (
    source_corpus,
    source_collection,
    command,
    created_at
);

CREATE INDEX IF NOT EXISTS internal_notice_consumption_admission_notice_ids_idx
ON ingestion_projection.internal_notice_consumption_admission USING gin (selected_notice_ids);

CREATE TABLE IF NOT EXISTS ingestion_projection.internal_notice_consumption_admission_event (
    event_id text PRIMARY KEY,
    batch_id text NOT NULL,
    source_corpus text NOT NULL,
    source_collection text NOT NULL,
    command text NOT NULL,
    selected_notice_ids text [] NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    event_created_at timestamptz NOT NULL,
    error text NOT NULL DEFAULT '',
    result_counts jsonb NOT NULL,
    selection_source text NOT NULL DEFAULT '',
    selection_path text NOT NULL DEFAULT '',
    selection_sha256 text NOT NULL DEFAULT '',
    command_args jsonb NOT NULL DEFAULT '{}'::jsonb,
    record jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS internal_notice_consumption_admission_event_batch_idx
ON ingestion_projection.internal_notice_consumption_admission_event (
    source_corpus,
    source_collection,
    batch_id,
    event_created_at
);

CREATE INDEX IF NOT EXISTS internal_notice_consumption_admission_event_command_idx
ON ingestion_projection.internal_notice_consumption_admission_event (
    source_corpus,
    source_collection,
    command,
    event_created_at
);

CREATE INDEX IF NOT EXISTS internal_notice_consumption_admission_event_notice_ids_idx
ON ingestion_projection.internal_notice_consumption_admission_event USING gin (
    selected_notice_ids
);

CREATE TABLE IF NOT EXISTS ingestion_projection.internal_notice_multimodal_attempt (
    source_corpus text NOT NULL,
    source_collection text NOT NULL,
    source_notice_id text NOT NULL,
    unit_id text NOT NULL,
    attempt_number integer NOT NULL,
    admission_batch_id text NOT NULL DEFAULT '',
    model text NOT NULL,
    decision_action text NOT NULL,
    status text NOT NULL,
    reasons jsonb NOT NULL,
    error text,
    created_at timestamptz NOT NULL,
    record jsonb NOT NULL,
    PRIMARY KEY (source_corpus, source_collection, unit_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS internal_notice_multimodal_attempt_notice_idx
ON ingestion_projection.internal_notice_multimodal_attempt (
    source_corpus,
    source_collection,
    source_notice_id
);

CREATE INDEX IF NOT EXISTS internal_notice_multimodal_attempt_admission_idx
ON ingestion_projection.internal_notice_multimodal_attempt (
    source_corpus,
    source_collection,
    admission_batch_id
);

CREATE TABLE IF NOT EXISTS ingestion_projection.internal_notice_schedule_image_ocr_attempt (
    source_corpus text NOT NULL,
    source_collection text NOT NULL,
    source_notice_id text NOT NULL,
    attachment_ref_id text NOT NULL,
    image_index integer NOT NULL,
    attempt_number integer NOT NULL,
    admission_batch_id text NOT NULL DEFAULT '',
    provider text NOT NULL,
    model text NOT NULL,
    status text NOT NULL,
    confidence text NOT NULL,
    provider_response_key text NOT NULL,
    layout_elements_key text NOT NULL,
    ocr_manifest_key text NOT NULL,
    run_id text NOT NULL DEFAULT '',
    error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL,
    record jsonb NOT NULL,
    PRIMARY KEY (
        source_corpus,
        source_collection,
        source_notice_id,
        attachment_ref_id,
        image_index,
        attempt_number
    )
);

CREATE INDEX IF NOT EXISTS internal_notice_schedule_image_ocr_attempt_notice_idx
ON ingestion_projection.internal_notice_schedule_image_ocr_attempt (
    source_corpus,
    source_collection,
    source_notice_id
);

CREATE INDEX IF NOT EXISTS internal_notice_schedule_image_ocr_attempt_admission_idx
ON ingestion_projection.internal_notice_schedule_image_ocr_attempt (
    source_corpus,
    source_collection,
    admission_batch_id
);

-- Projection and read-model admission provenance is stored inside record jsonb:
-- consumer_admission_batch_id, consumer_admission_command, consumer_admission_created_at.
