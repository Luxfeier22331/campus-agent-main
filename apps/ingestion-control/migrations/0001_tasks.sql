CREATE TABLE ingestion_control.tasks (
    task_id text PRIMARY KEY,
    run_id text NOT NULL,
    registry_task_id text NOT NULL,
    executor_kind text NOT NULL CHECK (executor_kind IN ('source_collector', 'rust_kernel')),
    source_family text,
    source_channel text,
    corpus text,
    collection text,
    input_ref_json jsonb NOT NULL,
    input_contract text NOT NULL,
    output_contract text NOT NULL,
    created_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'canceled')),
    workflow_id text NOT NULL UNIQUE,
    workflow_run_id text NOT NULL,
    updated_at timestamptz NOT NULL,
    result_ref_json jsonb,
    result_contract text,
    summary_json jsonb,
    error_code text,
    error_message text,
    CHECK ((source_family IS NULL) = (source_channel IS NULL)),
    CHECK ((corpus IS NULL) = (collection IS NULL)),
    CHECK (
        (
            status = 'completed'
            AND result_ref_json IS NOT NULL
            AND result_contract IS NOT NULL
            AND summary_json IS NOT NULL
            AND error_code IS NULL
            AND error_message IS NULL
        )
        OR (
            status = 'running'
            AND result_ref_json IS NULL
            AND result_contract IS NULL
            AND summary_json IS NULL
            AND error_code IS NULL
            AND error_message IS NULL
        )
        OR (
            status IN ('failed', 'canceled')
            AND result_ref_json IS NULL
            AND result_contract IS NULL
            AND summary_json IS NULL
            AND error_code IS NOT NULL
            AND error_message IS NOT NULL
        )
    )
);

CREATE INDEX ingestion_tasks_run_idx
ON ingestion_control.tasks (run_id, updated_at DESC, task_id DESC);
CREATE INDEX ingestion_tasks_registry_idx
ON ingestion_control.tasks (registry_task_id, updated_at DESC, task_id DESC);
CREATE INDEX ingestion_tasks_target_idx
ON ingestion_control.tasks (corpus, collection, updated_at DESC, task_id DESC);
CREATE INDEX ingestion_tasks_source_idx
ON ingestion_control.tasks (source_family, source_channel, updated_at DESC, task_id DESC);

CREATE TABLE ingestion_control.official_web_url_freshness (
    site_id text NOT NULL,
    normalized_canonical_url text NOT NULL,
    host text NOT NULL,
    page_family text NOT NULL,
    page_title_normalized text NOT NULL,
    discovery_method text NOT NULL,
    discovered_from_url text,
    last_fetch_disposition text NOT NULL CHECK (
        last_fetch_disposition IN ('fetched', 'not_modified', 'deleted', 'fetch_failed')
    ),
    last_http_status integer,
    content_type text,
    etag text,
    last_modified text,
    response_body_hash text,
    main_content_hash text,
    last_seen_at timestamptz NOT NULL,
    last_observed_run_id text NOT NULL,
    last_changed_at timestamptz,
    last_not_modified_at timestamptz,
    cadence_class text NOT NULL,
    priority_score integer NOT NULL,
    next_eligible_fetch_at timestamptz NOT NULL,
    last_successful_run_id text,
    last_change_reason text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (site_id, normalized_canonical_url)
);

CREATE INDEX ingestion_official_web_freshness_due_idx
ON ingestion_control.official_web_url_freshness (
    site_id, next_eligible_fetch_at, priority_score DESC
);

CREATE INDEX ingestion_official_web_freshness_host_idx
ON ingestion_control.official_web_url_freshness (site_id, host, updated_at DESC);

CREATE TABLE ingestion_control.official_web_seed_state (
    site_id text NOT NULL,
    configured_seed_url text NOT NULL,
    normalized_canonical_url text NOT NULL,
    last_observed_run_id text NOT NULL,
    last_seen_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (site_id, configured_seed_url)
);
