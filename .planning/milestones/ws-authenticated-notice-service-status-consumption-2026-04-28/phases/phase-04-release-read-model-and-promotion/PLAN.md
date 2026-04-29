---
doc_type: plan
status: implemented
created: 2026-04-28
updated: 2026-04-28
phase: Phase 4
workstream: authenticated-notice-service-status-consumption
---
# Phase 4 Plan: Release Read Model And Promotion

<!-- markdownlint-disable MD013 -->

## Goal

把 service status publication 对齐 ADR-0044 和 transport schedule 的 release
workflow： `preview -> stage -> promote`，并验证 PG current pointer + typed read
model。

## Tasks

1. Add publish modes to `build_service_status_projection`.
   - `preview`: local artifacts only; no object-store write, no PG write.
   - `stage`: versioned artifact + PG release/read-model rows; current pointer
     unchanged.
   - `promote`: versioned artifact + PG release/read-model rows + current
     pointer update.
1. Add `write_current` support to service-status release artifact writer.
   - Avoid writing mutable object-store current artifact during stage.
   - Keep immutable versioned artifact truth.
1. Publish rejected-source report with release artifacts.
1. Ensure `PostgresStructuredProjectionPublisher.publish_release(...
   promote_current=False)` works for `service_status`.
1. Extend manage CLI smoke coverage for current/list/promote on
   `service_status`.
1. Update tests to mirror transport schedule stage/promote behavior.

## Expected Artifacts

- Updated `apps/ingestion-worker/src/campus_ingestion_worker/build_service_status_projection.py`
- Updated `packages/ingestion-core/src/campus_ingestion_core/service_status_projection.py`
- Updated `tests/ingestion/test_build_service_status_projection_worker.py`
- Updated `tests/ingestion/test_structured_projection_postgres.py`

## Acceptance Criteria

- Stage mode never moves current pointer.
- Promote mode updates current only after typed rows and release row are
  written.
- Release report makes accepted/rejected counts observable.
- Publication failure leaves previous current release untouched.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres
```
