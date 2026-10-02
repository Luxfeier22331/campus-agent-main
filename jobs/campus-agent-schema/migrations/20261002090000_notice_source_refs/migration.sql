ALTER TABLE notices.notices ADD COLUMN source_ref text, ADD COLUMN published_source_ref text;
ALTER TABLE notices.notices ADD CONSTRAINT notices_source_ref_check CHECK (
    source_ref IS NULL OR source_ref ~ '^internal_portal/notices/[0-9]+/sources/[0-9a-f]{64}\.json$'
),
ADD CONSTRAINT notices_published_source_ref_check CHECK (
    published_source_ref IS NULL
    OR published_source_ref ~ '^internal_portal/notices/[0-9]+/sources/[0-9a-f]{64}\.json$'
);
CREATE INDEX notices_pending_source_publication_idx ON notices.notices (notice_id)
WHERE source_ref IS NOT NULL AND source_ref IS DISTINCT FROM published_source_ref;
