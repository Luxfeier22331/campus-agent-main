DO $notices_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    RAISE EXCEPTION 'app_api database role is missing';
  END IF;
END
$notices_roles$;

REVOKE ALL PRIVILEGES ON SCHEMA notices FROM app_api;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA notices FROM app_api;
GRANT USAGE ON SCHEMA notices TO app_api;
GRANT SELECT ON TABLE
notices.notice_types,
notices.organizations,
notices.domains,
notices.notices,
notices.notice_assets
TO app_api;

INSERT INTO notices.schema_migrations (version) VALUES (2);
