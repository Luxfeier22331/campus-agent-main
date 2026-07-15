# `authenticated_documents/file_release_source`

This scope holds canonical `internal_portal/file_release` source
records plus the released original file provenance.

Current boundary:

- stop at source-truth and document holding
- raw asset registry points at the released original bytes
- capture and verified source-manifest production are owned by the
  `internal_portal.file_release.capture` source-collector activity
- `reference_only` collector rows fail closed and stay outside this holding
  scope
- no regulation promotion or restricted document-center serving in this scope
