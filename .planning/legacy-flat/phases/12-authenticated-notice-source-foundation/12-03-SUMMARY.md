# 12-03 Summary

## Outcome

- `apps/authenticated-notice-collector` now emits typed bootstrap artifacts that are closer to the repo’s long-term source-truth direction instead of leaving `links / notice_attachments / attachments` as empty placeholders.
- collector notice-type governance is now validated and snapshot into the export manifest, so the importer can replay with explicit policy evidence rather than only a bare type-id list.
- importer compatibility remains unchanged at the contract boundary: reference-only attachment refs are accepted without promoting local filesystem paths or object keys into required truth.

## Main Changes

- `apps/authenticated-notice-collector/src/bootstrap-export.ts`
  - extracts HTML-derived link observations from notice content
  - derives reference-only attachment observations and `notice_attachments` relations for attachment-like links
  - records collector export metadata plus `notice_type_policy` in the export manifest
- `apps/authenticated-notice-collector/src/types.ts`
  - replaces empty-record placeholders with explicit typed link / attachment / manifest metadata shapes
- `apps/authenticated-notice-collector/src/notice-types.ts`
  - validates notice-type config uniqueness and page-size/page-count sanity
  - exposes a policy snapshot builder for export manifest persistence
- `tests/ingestion/test_authenticated_notice_import.py`
  - proves importer/source-truth reconstruction accepts reference-only attachments with `object_key=null`
- `docs/plans/authenticated-notice-source-foundation.md`
  - freezes the collector convergence direction as typed reference-only artifacts, not local-path semantics

## Verification

- `pnpm --dir apps/authenticated-notice-collector test`
- `pnpm --dir apps/authenticated-notice-collector typecheck`
- `pnpm --dir apps/authenticated-notice-collector build`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker`

## Deferred After This Slice

- collector still does not own attachment downloading or object upload
- collector still does not own registry writes, chunking, index release, or query-serving
- live portal scheduling and authenticated control-plane work remain separate future scope
