---
doc_type: contract
truth_scope: data
owner_boundary: authenticated-notice
status: active
created: 2026-04-12
updated: 2026-07-13
---
# File Release Export

## Boundary

`internal_portal.file_release.capture` captures the portal's file-release
surface as an authenticated document source. It is separate from canonical
notice source truth and is not an online document or regulation service.

## Request

`internal_portal_file_release_capture_request.v1` accepts:

- optional positive `max_file_releases`;
- optional positive `max_pages`;
- `page_size` from 1 to 200, default 20;
- optional exact positive `target_file_release_id`.

The request is stored as a SHA-256-pinned object and referenced by an
`ingestion_task_envelope.v3` for
`internal_portal.file_release.capture`.

## Capture Output

For each portal record the collector preserves:

- file-release identity and metadata;
- source/detail/download URLs and capture timestamps;
- released-file name, media type, byte size, and provenance;
- capture disposition;
- source-bucket object key and SHA-256 when bytes were captured.

The collector writes a bundle and export manifest, then materializes verified
source refs. Only object-backed rows with matching bytes/digest are admitted.
`reference_only`, missing, or mismatched bytes fail closed for source
materialization.

The stable source object key is derived from file-release identity, year, and
content digest; local export file paths are diagnostics only and never cross
the task boundary.

## Result

The activity writes `authenticated_file_release_source_manifest.v1` and returns
`ingestion_task_result.v1` pointing to its result manifest. The bounded summary
contains file/page/upload counts. A PostgreSQL run ledger or implicit lookup is
not part of the contract.

## Non-Goals

- notice source-truth mutation;
- title-based fuzzy selection;
- OCR or document normalization;
- regulation promotion;
- chunk/index/alias publication;
- query serving.

## Owners

- capture implementation:
  `apps/source-collector/adapters/internal-portal/src/file-release-export-core.ts`;
- runtime activity: `apps/source-collector/src/activities.ts`;
- source-ref validation: `packages/ingest-core`;
- workflow and terminal projection: `apps/ingestion-control`.

## Related Documents

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice.md`
- `docs/runbooks/notice-release-auth-window.md`
