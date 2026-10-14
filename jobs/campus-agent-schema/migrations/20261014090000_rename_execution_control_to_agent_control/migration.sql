-- The agent-control DatabaseRole is provisioned by CNPG before this migration.
-- The rename preserves all rows, object identities, indexes, views, and foreign keys.
ALTER SCHEMA execution_control RENAME TO agent_control;

GRANT USAGE ON SCHEMA agent_control TO agent_control;
GRANT USAGE ON SCHEMA agent_control TO ops_web;
GRANT USAGE ON SCHEMA agent_control TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent_control TO agent_control;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA agent_control TO agent_control;
ALTER DEFAULT PRIVILEGES IN SCHEMA agent_control
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agent_control;
ALTER DEFAULT PRIVILEGES IN SCHEMA agent_control
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO agent_control;

GRANT USAGE ON SCHEMA campus_docs_serving TO agent_control;
GRANT SELECT, INSERT, UPDATE ON TABLE campus_docs_serving.current_index TO agent_control;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE campus_docs_serving.index_versions TO agent_control;
