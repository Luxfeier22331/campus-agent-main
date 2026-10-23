-- Ops consumes terminal failure metadata, never the event body or answer deltas.
CREATE OR REPLACE VIEW execution_control.ops_terminal_failures WITH (security_barrier = true) AS
-- Existing view column positions must stay stable for CREATE OR REPLACE VIEW.
SELECT -- noqa: ST06
    terminal.request_id,
    terminal.occurred_at,
    terminal.event_id,
    left(terminal.payload_json ->> 'failure_kind', 128) AS code,
    left(activity.failure ->> 'operation', 128) AS operation,
    left(activity.failure ->> 'detail', 1024) AS detail,
    left(activity.failure ->> 'invocation_id', 256) AS invocation_id,
    activity.failure -> 'http_status' AS http_status,
    left(activity.failure ->> 'reason', 64) AS reason,
    activity.failure -> 'citation' AS citation,
    activity.step_id AS step_id,
    left(activity.failure ->> 'source_code', 128) AS source_code
FROM execution_control.agent_run_events AS terminal
LEFT JOIN LATERAL (
    SELECT
        payload_json -> 'failure' AS failure,
        left(payload_json ->> 'step_id', 128) AS step_id
    FROM execution_control.agent_run_events
    WHERE
        request_id = terminal.request_id
        AND event_type = 'activity.failed'
        AND occurred_at <= terminal.occurred_at
        AND payload_json -> 'failure' ->> 'code' = terminal.payload_json ->> 'failure_kind'
    ORDER BY occurred_at DESC, sequence DESC
    LIMIT 1
) AS activity ON true
WHERE terminal.event_type = 'run.failed';
--> statement-breakpoint
GRANT SELECT ON execution_control.ops_terminal_failures TO ops_web;
