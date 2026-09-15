GRANT USAGE ON SCHEMA execution_control TO app_api;
--> statement-breakpoint
GRANT SELECT (request_id, status) ON TABLE execution_control.agent_runs TO app_api;
