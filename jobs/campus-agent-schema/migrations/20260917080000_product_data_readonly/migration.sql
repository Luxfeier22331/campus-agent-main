-- Provision product_data_ro before running this migration.
DO $grant_connect$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO product_data_ro', current_database());
END
$grant_connect$;
GRANT USAGE ON SCHEMA notices,
campus_groups,
transport,
dining,
campus_docs_serving TO product_data_ro;
GRANT SELECT ON TABLE
notices.categories, notices.notice_types, notices.organizations,
notices.notices, notices.notice_assets,
campus_groups.sections, campus_groups.groups,
transport.routes, transport.schedule_periods, transport.schedule_items,
transport.schedule_period_notices,
dining.map_draft, dining.map_releases, dining.map_publication, dining.menu_items,
campus_docs_serving.current_index
TO product_data_ro;
