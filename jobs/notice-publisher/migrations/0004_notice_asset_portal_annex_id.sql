ALTER TABLE notices.notice_assets
ADD COLUMN portal_annex_id text;

INSERT INTO notices.schema_migrations (version) VALUES (4);
