-- Contract after the first retrieval-index Apply: current_index carries the artifact references,
-- and no remaining reader uses the old publisher ledger or rollback target.
DROP TABLE campus_docs_serving.index_versions;
ALTER TABLE campus_docs_serving.current_index DROP COLUMN previous_collection;
