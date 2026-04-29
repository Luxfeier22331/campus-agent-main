---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary: Current-State Audit And Reset Manifest

## Result

Phase 1 completed a read-only audit of the local shared PG notice consumption state and generated a no-write reset manifest.

## Evidence

- `../../evidence/phase-01-current-state-audit-and-reset-manifest/captured-runs-inventory.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/source-truth-inventory-audit.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/derived-state-inventory.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/downstream-release-inventory.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/reset-manifest.dry-run.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/reset-backup-plan.md`

## Observed State

- collector run ledger: `76` rows.
- source-truth inventory:
  - `campus_notices/internal_notice`: `308` rows.
  - `authenticated_documents/common_download_source`: `22` rows.
- file-release inventory:
  - `authenticated_documents/file_release_source`: `56` rows.
  - `campus_notices/file_release_capture`: `56` rows.
- derived consumption:
  - `notice_consumption_projection`: `68` rows.
  - `internal_notice_read_model`: `0` rows.
  - `internal_notice_consumption_admission`: `28` rows.
  - `internal_notice_schedule_image_ocr_attempt`: `13` rows.
- downstream typed state:
  - `service_status_read_model`: `11` rows.
  - `service_guide_read_model`: `33` rows.
  - `transport_release_notices`: `218` rows.

## Manual Confirmation Before Reset

Phase 2 must resolve two reset boundaries before Phase 3 can write:

- Whether reset should clear source-truth / holding inventory rows to return strictly to collected-but-not-imported.
- How to reset the mixed `service_guide` current release without deleting stable handbook/campus-card rows.
