ALTER TABLE transport.schedule_periods ADD COLUMN drop_off_point_override text;

GRANT SELECT ON transport.schedule_period_notices TO app_api;
