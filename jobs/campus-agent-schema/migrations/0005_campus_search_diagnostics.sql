CREATE TABLE execution_control.agent_campus_search_diagnostics (
    request_id text NOT NULL REFERENCES execution_control.agent_runs (request_id) ON DELETE CASCADE,
    invocation_id text NOT NULL,
    workflow_step_id text NOT NULL,
    activity_attempt integer NOT NULL CHECK (activity_attempt > 0),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    search_query text NOT NULL CHECK (char_length(search_query) <= 400),
    status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'canceled')),
    current_phase text NOT NULL,
    phase_rank integer NOT NULL,
    phase_times_json jsonb NOT NULL DEFAULT '{}',
    snapshot_json jsonb NOT NULL DEFAULT '{}',
    failure_code text,
    http_status integer,
    cited_result_refs text[],
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, invocation_id)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
ON execution_control.agent_campus_search_diagnostics TO execution_control;
GRANT SELECT (
    request_id, invocation_id, workflow_step_id, activity_attempt, schema_version, search_query,
    status, current_phase, phase_times_json, snapshot_json, failure_code, http_status,
    cited_result_refs, updated_at
) ON execution_control.agent_campus_search_diagnostics TO ops_web;
