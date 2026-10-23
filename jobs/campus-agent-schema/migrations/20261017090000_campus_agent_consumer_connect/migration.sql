-- Every login role that consumes the shared campus_agent database gets an explicit
-- CONNECT so a from-scratch install never depends on the PUBLIC default. The roles
-- are provisioned by CNPG DatabaseRole before this migration runs.
DO $grant_connect$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO campus_agent', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_api', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO agent_control', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO campus_search', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO model_config', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO ops_web', current_database());
END
$grant_connect$;
