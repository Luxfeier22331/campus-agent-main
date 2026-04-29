---
doc_type: plan
status: implemented
created: 2026-04-28
updated: 2026-04-28
phase: Phase 2
workstream: authenticated-notice-service-status-consumption
---
# Phase 2 Plan: Projection Contract And Schema

<!-- markdownlint-disable MD013 -->

## Goal

把 `service_status_records` 从当前窄字段升级为长期可维护的 service-status typed projection
contract，并同步 validation、read model typed columns 和 docs。

## Tasks

1. Extend the projection schema.
   - Required: `subject_id`, `display_name`, `service_family`,
     `observed_status`, `effective_from`, `effective_until`,
     `related_notice_refs`.
   - Recommended: `aliases`, `campus_scope`, `location_refs`, `platform_refs`,
     `affected_scope`, `status_reason`, `status_note`, `severity`,
     `normal_status_ref`, `override_source_refs`, `extraction_status`.
1. Define rejected-source report shape.
   - Include `source_notice_id`, `source_ref`, `notice_family`, `reason`,
     `missing_fields`, `candidate_kind`, and optional `extracted_signals`.
1. Update validation rules.
   - Reject missing effective window, missing source refs, unsupported status,
     duplicate subject/window conflicts, and unknown service family.
1. Align PostgreSQL typed read model.
   - Add typed columns only where runtime filtering/search needs first-class
     access.
   - Keep full original row in `record jsonb`.
1. Update contracts/docs only where needed.
   - Do not leak object-store or PG implementation details into
     `packages/contracts`.

## Expected Artifacts

- Updated `packages/ingestion-core/src/campus_ingestion_core/service_status_projection.py`
- Updated `packages/ingestion-core/src/campus_ingestion_core/structured_projection_postgres.py`
- Updated tests under `tests/ingestion/`
- Optional doc update if contract language changes

## Acceptance Criteria

- Schema expresses all Phase 1 selected cohort families.
- Invalid/incomplete service-status records fail validation before publication.
- Existing runtime fixtures either remain compatible or are deliberately
  migrated.
- No runtime query path reads raw notice or object-storage current JSON.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_structured_projection_postgres \
  tests.ingestion.test_notice_derived_service_status_materialization
```
