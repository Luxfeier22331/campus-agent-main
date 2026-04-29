---
doc_type: evidence
status: draft
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Reset Backup Plan

This plan is Phase 1 evidence only. It does not execute backup, reset, import, OCR, or downstream replay.

## Read-Only Evidence

Phase 1 generated these read-only artifacts:

- `captured-runs-inventory.json`
- `source-truth-inventory-audit.json`
- `derived-state-inventory.json`
- `downstream-release-inventory.json`
- `reset-manifest.dry-run.json`

The database connection was opened with `default_transaction_read_only=on`.

## Retained Truth

Phase 3 reset must retain:

- `ingestion_projection.authenticated_notice_collector_run`
- source bucket captured objects
- object locator audit evidence
- workstream evidence and run reports

These are captured source-channel truth, not downstream consumption state.

## Backup Scope Before Any Reset

Before Phase 3 can execute reset, export row-level backup artifacts for every reset or manual-confirmation scope:

- `ingestion_projection.authenticated_notice_source_truth_inventory`
- `ingestion_projection.authenticated_notice_file_release_inventory`
- `ingestion_projection.notice_consumption_projection`
- `ingestion_projection.internal_notice_read_model`
- `ingestion_projection.internal_notice_consumption_admission`
- `ingestion_projection.internal_notice_consumption_admission_event`
- `ingestion_projection.internal_notice_multimodal_attempt`
- `ingestion_projection.internal_notice_schedule_image_ocr_attempt`
- `ingestion_projection.wechat_public_notice_multimodal_attempt`
- `ingestion_projection.structured_projection_current`
- `ingestion_projection.structured_projection_releases`
- `ingestion_projection.service_status_read_model`
- `ingestion_projection.service_guide_read_model`
- `ingestion_projection.transport_release_notices`
- `ingestion_projection.transport_operational_notices`
- `ingestion_projection.transport_routes`
- `ingestion_projection.transport_schedule_snapshots`
- `ingestion_projection.transport_scheduled_departures`
- `ingestion_projection.transport_service_exceptions`
- `ingestion_projection.transport_rejected_sources`

Recommended Phase 3 backup output path:

`./backup/reset-derived-state-pre-execute-<timestamp>/`

Each table backup should include:

- table name
- row count
- exported rows
- export timestamp
- database metadata
- reset manifest checksum

## Manual Confirmation Items

Two reset scopes must remain blocked until Phase 2 freezes the chain contract:

1. `source_truth_and_document_holding_reset_scope`
   - If the target is strictly "collected but not imported", Phase 3 must clear source-truth / holding inventories after backup.
   - If the target is only "collected but not consumed", these rows should be retained.
2. `mixed_service_guide_current_release`
   - Current `service_guide` read model mixes stable handbook/campus-card rows with notice-derived rows.
   - Phase 3 must either remove only notice-derived rows or roll current back to a stable non-notice release.

## Rollback Shape

Rollback must be row-level and table-scoped:

1. Stop replay/import jobs.
2. Reinsert backed-up rows for the affected table set inside one transaction.
3. Restore `structured_projection_current` after release/read-model rows are restored.
4. Re-run read-only inventory audit.
5. Compare row counts and release ids with the backup manifest.

Rollback must not recreate source bucket objects, because reset must not delete them.

## Phase 1 Verdict

Phase 1 confirms that a reset can be planned without touching source objects or collector run ledger.
It does not authorize Phase 3 execution until Phase 2 resolves the source-truth reset boundary and service-guide mixed current release boundary.
