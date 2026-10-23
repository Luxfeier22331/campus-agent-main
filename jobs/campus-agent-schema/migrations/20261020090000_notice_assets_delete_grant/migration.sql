-- Notice republish replaces a notice's asset projection wholesale
-- (DELETE + re-INSERT in replaceAssets), so notice_publisher needs DELETE
-- on notice_assets alongside the baseline SELECT/INSERT/UPDATE grant.
DO $optional_notice_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        GRANT DELETE ON TABLE notices.notice_assets TO notice_publisher;
    END IF;
END
$optional_notice_publisher$;
