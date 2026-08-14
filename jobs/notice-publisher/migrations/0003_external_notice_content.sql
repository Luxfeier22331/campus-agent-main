UPDATE notices.notices
SET
    content_html = NULL,
    content_text = NULL
WHERE
    is_external
    AND (content_html IS NOT NULL OR content_text IS NOT NULL);

ALTER TABLE notices.notices
ADD CONSTRAINT notices_external_content_check
CHECK (NOT is_external OR (content_html IS NULL AND content_text IS NULL));

INSERT INTO notices.schema_migrations (version) VALUES (3);
