ALTER TABLE execution_control.agent_step_results
ADD COLUMN model_output_diagnostic_json jsonb;
--> statement-breakpoint
GRANT SELECT (request_id, step_id, attempt_id, model_output_diagnostic_json)
ON execution_control.agent_step_results TO ops_web;
