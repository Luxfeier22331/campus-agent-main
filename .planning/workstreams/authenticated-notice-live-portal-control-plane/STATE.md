---
workstream: authenticated-notice-live-portal-control-plane
created: 2026-04-19
updated: 2026-04-25
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** A
**Current Phase Name:** Collector Runtime / Repo Migration Truth Refresh
**Current Plan:** continue from refreshed live capture/source-truth baseline into scheduler admission and bounded operator control-plane
**Total Phases:** 6
**Total Plans in Phase:** N/A
**Progress:** 0/6 phases complete
**Last Activity:** 2026-04-25
**Last Activity Description:** Restored authenticated portal access through the trusted proxy path, added explicit collector proxy propagation for Playwright browser/API contexts, fixed HTML inline-image attachment discovery, refreshed the live notice export, imported the refreshed 60-notice slice into source-truth inventory, added fetch-status/reference-only doctors, and wired collector run ledger artifact refs.

## Reopen Rule

- 已恢复；后续暂停只应由认证窗口失效、portal policy 变化，或 source-channel control-plane scope 暂停触发

## Blockers

- No current auth blocker after the 2026-04-25 refresh.
- Remaining blockers are not capture blockers: scheduler admission and bounded operator APIs are still unimplemented workstream phases.

## Latest Capture Baseline

- Auth readiness: `pnpm --dir apps/authenticated-notice-collector auth:check` passed through the proxy path before live export.
- Notice export: `apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260425T122117.555Z.json`
- Notice manifest: `apps/authenticated-notice-collector/runtime/exports/export-manifest-20260425T122117.555Z.json`
- Notice export counts: `noticesCollected=60`, `detailFetched=60`, `attachmentObjectsUploaded=80`
- Source-truth import: `notice_count=60`, `raw_uploaded_count=14`, `raw_reused_count=46`, `errors=[]`
- PG inventory check: `source_truth_inventory_entries=60`, `attachment_ref_total=80`, `attachment_document_total=49`, `ocr_required_total=24`, `multimodal_required_total=1`
- 2026-04-25 selected attachment refresh / inventory status:
  - source-truth inventory now has `source_truth_inventory_entries=71`, `attachment_ref_total=101`
  - attachment fetch-status ledger coverage is complete: `fetch_status_record_count=101`, missing/extra refs `0`
  - fetch-status counts: `collected_internal=98`, `terminal_unavailable=3`, terminal reason `http_404=3`
  - reference-only explanation doctor reports `reference_only_attachment_count=9`, `object_backed_inline_image_reference_only=6`, `terminal_unavailable=3`, `action_required_count=0`
- Collector run ledger path now persists collection mode, selected notice ids, attachment outcome counts, local artifact paths, and source object refs for exported bundle/manifest when source-bucket credentials are configured.
- File release export: `apps/authenticated-notice-collector/runtime/exports/file-releases-bundle-20260425T132436.639Z.json`
- File release manifest: `apps/authenticated-notice-collector/runtime/exports/file-releases-manifest-20260425T132436.639Z.json`
- File release export counts: `fileReleasesCollected=56`, `detailFetched=56`, `fileUrlsResolved=56`, `fileObjectsUploaded=56`
- File release capture inventory: `inventory_upsert_count=56`, `raw_asset_upsert_count=56`, `reference_only_count=0`; PG check shows `released_file_storage_provider=object_store` and `released_file_ingest_status=uploaded` for all 56 rows.
- Recovered capture gap: notice `355549` now has one `inline_image` attachment ref and uploaded PNG object.
- Recovered import gap: notice `355798` legacy `.doc` attachments now classify as `text_extractable` via the shared legacy Office extractor path instead of blocking source-truth inventory rebuild.

## Session Continuity

**Stopped At:** refreshed live source-channel baseline imported; run ledger/artifact refs and reference-only doctors implemented; continue with scheduler admission / bounded operator control-plane phases
**Resume File:** `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md`
