-- Internal diagnostic hard cut. Product requests, messages and retrieval data are retained.
DELETE FROM execution_control.agent_campus_search_diagnostics;
--> statement-breakpoint
ALTER TABLE execution_control.agent_campus_search_diagnostics
DROP CONSTRAINT agent_campus_search_diagnostics_schema_version_check,
ALTER COLUMN schema_version SET DEFAULT 2,
ADD CONSTRAINT agent_campus_search_diagnostics_schema_version_check CHECK (schema_version = 2);
