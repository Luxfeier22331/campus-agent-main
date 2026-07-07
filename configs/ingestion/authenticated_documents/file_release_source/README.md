# `authenticated_documents/file_release_source`

This scope holds canonical `internal_portal/file_release` source
records plus the released original file provenance.

Current boundary:

- stop at source-truth and document holding
- raw asset registry points at the released original bytes
- materialization is owned by `apps/ingestion-control` via
  `source_truth_materialize`
- `reference_only` collector rows fail closed and stay outside this holding
  scope
- no regulation promotion or restricted document-center serving in this scope
