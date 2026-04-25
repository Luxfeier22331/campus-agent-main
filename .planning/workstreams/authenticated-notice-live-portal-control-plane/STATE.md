---
workstream: authenticated-notice-live-portal-control-plane
created: 2026-04-19
updated: 2026-04-26
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** F
**Current Phase Name:** Planning Closeout
**Current Plan:** source-channel live capture/control-plane closeout complete; future work should be opened as a new workstream if product/API scheduling is required
**Total Phases:** 6
**Total Plans in Phase:** N/A
**Progress:** 6/6 phases complete
**Last Activity:** 2026-04-26
**Last Activity Description:** Completed collector run admission, live-historical reconcile, bounded operator status, widened authenticated notice-type live policy, 282-notice source-truth import, attachment fetch/reference-only doctor truth, and unsupported `.zip` terminal source-truth outcome handling.

## Reopen Rule

- 已恢复；后续暂停只应由认证窗口失效、portal policy 变化，或 source-channel control-plane scope 暂停触发

## Blockers

- No current auth blocker after the 2026-04-25 refresh.
- No remaining repo-owned capture/control-plane blocker in this workstream.

## Latest Capture Baseline

- Auth readiness: `pnpm --dir apps/authenticated-notice-collector auth:check` passed through the proxy path before live export.
- Notice export: `apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260425T160740.792Z.json`
- Notice manifest: `apps/authenticated-notice-collector/runtime/exports/export-manifest-20260425T160740.792Z.json`
- Notice export counts: `noticesCollected=282`, `detailFetched=282`, `attachmentObjectsUploaded=311`, `pagesFetched=15`
- Source-truth import: `notice_count=282`, `raw_uploaded_count=0`, `raw_reused_count=282`, `errors=[]`
- PG inventory check: `source_truth_inventory_entries=282`, `attachment_ref_total=311`, `unsupported_notice_count=1`, `unsupported_binary_count=1`
- 2026-04-25 selected attachment refresh / inventory status:
  - source-truth inventory now has `source_truth_inventory_entries=71`, `attachment_ref_total=101`
  - attachment fetch-status ledger coverage is complete: `fetch_status_record_count=101`, missing/extra refs `0`
  - fetch-status counts: `collected_internal=98`, `terminal_unavailable=3`, terminal reason `http_404=3`
  - reference-only explanation doctor reports `reference_only_attachment_count=9`, `object_backed_inline_image_reference_only=6`, `terminal_unavailable=3`, `action_required_count=0`
- 2026-04-26 widened notice-type refresh / inventory status:
  - default-enabled notice types: `5`, `6`, `8`, `11`, `32`, `9980`, `9982`
  - full configured policy also tracks disabled types: `10`, `36`, `9978`, `9979`
  - source-truth inventory now has `source_truth_inventory_entries=282`, `attachment_ref_total=311`
  - attachment fetch-status coverage has no missing refs for current inventory; ledger still carries 21 extra historical rows from older slices
  - fetch-status counts: `collected_internal=329`, `terminal_unavailable=3`, terminal reason `http_404=3`
  - reference-only explanation doctor reports `reference_only_attachment_count=20`, `object_backed_inline_image_reference_only=20`, `action_required_count=0`
  - unsupported terminal truth: notice `355493` has `attachment-0006` / `优秀毕业生相关报送材料.zip` recorded as `unsupported_binary`; it is not counted as `reference_only`
- Collector run ledger path now persists collection mode, selected notice ids, attachment outcome counts, local artifact paths, and source object refs for exported bundle/manifest when source-bucket credentials are configured.
- Collector run admission now fail-closes invalid runs before API context creation:
  - incremental/backfill require at least one enabled notice type
  - selected mode requires selected notice ids
  - export manifest records admitted notice types, selected notices, expected page count, page budget, and rejection reason shape
- Live-historical reconcile now has repo-owned report / CLI:
  - compares source-truth inventory attachment refs with attachment fetch-status rows
  - reports missing refs, extra historical refs, status counts, terminal reasons
  - flags attachment owner-expectation mismatch where body declares an attachment but the captured payload has no attachment entity/ref
- Bounded operator status now aggregates inventory, reconcile, reference-only explanation, unsupported binary count, multimodal count, and latest collector run ledger when configured.
- File release export: `apps/authenticated-notice-collector/runtime/exports/file-releases-bundle-20260425T132436.639Z.json`
- File release manifest: `apps/authenticated-notice-collector/runtime/exports/file-releases-manifest-20260425T132436.639Z.json`
- File release export counts: `fileReleasesCollected=56`, `detailFetched=56`, `fileUrlsResolved=56`, `fileObjectsUploaded=56`
- File release capture inventory: `inventory_upsert_count=56`, `raw_asset_upsert_count=56`, `reference_only_count=0`; PG check shows `released_file_storage_provider=object_store` and `released_file_ingest_status=uploaded` for all 56 rows.
- Recovered capture gap: notice `355549` now has one `inline_image` attachment ref and uploaded PNG object.
- Recovered import gap: notice `355798` legacy `.doc` attachments now classify as `text_extractable` via the shared legacy Office extractor path instead of blocking source-truth inventory rebuild.

## Session Continuity

**Stopped At:** repo-owned authenticated notice live capture/control-plane closeout completed; future auth work should start from a new scoped workstream
**Resume File:** `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md`
