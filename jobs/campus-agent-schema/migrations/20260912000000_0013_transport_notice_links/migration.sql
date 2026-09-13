CREATE TABLE transport.schedule_period_notices (
    schedule_id text NOT NULL REFERENCES transport.schedule_periods (schedule_id) ON DELETE CASCADE,
    notice_id bigint NOT NULL REFERENCES notices.notices (notice_id) ON DELETE CASCADE,
    summary text,
    PRIMARY KEY (schedule_id, notice_id)
);

CREATE INDEX transport_schedule_period_notices_notice_idx
ON transport.schedule_period_notices (notice_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON transport.schedule_period_notices TO ops_web;
