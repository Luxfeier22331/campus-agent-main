-- Expand only: notice-artifacts-worker and the old Ops Web still read index_versions and
-- previous_collection while the retrieval-index release rolls out.
ALTER TABLE campus_docs_serving.current_index
ADD COLUMN docs_embedding_set text CHECK (docs_embedding_set ~ '^sha256:[a-f0-9]{64}$'),
ADD COLUMN notice_embedding_set text CHECK (notice_embedding_set ~ '^sha256:[a-f0-9]{64}$');
UPDATE campus_docs_serving.current_index c SET
    docs_embedding_set = v.docs_embedding_set,
    notice_embedding_set = v.notice_embedding_set
FROM campus_docs_serving.index_versions v WHERE c.collection = v.collection;
