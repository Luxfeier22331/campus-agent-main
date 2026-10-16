-- The agent-control DatabaseRole is provisioned by CNPG before this migration.
DO $grant_connect$
BEGIN
    EXECUTE format(
        'GRANT CONNECT ON DATABASE %I TO agent_control',
        current_database()
    );
END
$grant_connect$;
