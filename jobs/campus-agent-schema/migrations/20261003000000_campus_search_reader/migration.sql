-- Provision campus_search before the schema Job runs.
DO $grant_connect$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO campus_search', current_database());
END
$grant_connect$;
GRANT USAGE ON SCHEMA campus_docs_serving TO campus_search;
GRANT SELECT ON TABLE campus_docs_serving.current_index TO campus_search;
