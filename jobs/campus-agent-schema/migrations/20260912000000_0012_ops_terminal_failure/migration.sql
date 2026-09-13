-- Ops consumes terminal failure metadata, never the event body or answer deltas.
CREATE VIEW execution_control.ops_terminal_failures WITH (security_barrier = true) AS
SELECT
    terminal.request_id,
    terminal.occurred_at,
    terminal.event_id,
    left(terminal.payload_json ->> 'failure_kind', 128) AS code,
    left(activity.failure ->> 'operation', 128) AS operation,
    left(activity.failure ->> 'detail', 1024) AS detail,
    left(activity.failure ->> 'invocation_id', 256) AS invocation_id,
    activity.failure -> 'http_status' AS http_status
FROM execution_control.agent_run_events AS terminal
LEFT JOIN LATERAL (
    SELECT payload_json -> 'failure' AS failure
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
