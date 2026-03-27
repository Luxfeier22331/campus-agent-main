---
phase: 02-student-handbook-raw-ingestion
plan: "02"
subsystem: ingestion
tags: [handbook-cleanup, import-report, registry, fixtures, pytest, unittest]
requires:
  - phase: 02-student-handbook-raw-ingestion
    provides: canonical raw registration and normalized handbook trust checks
provides:
  - machine-checkable created/updated/skipped document reporting for handbook normalized ingestion
  - fixture-backed duplicate/update regression coverage for handbook OCR normalization
  - phase-2 repo-level verification evidence for ING-01 closure
affects: [ingestion-core, registry, downstream processing, future retrieval phases]
tech-stack:
  added: []
  patterns: [logical-document dedupe, content-driven version progression, report-bucket verification]
key-files:
  created:
    - tests/fixtures/student_handbook/provider-result-stable.jsonl
    - tests/fixtures/student_handbook/provider-result-updated.jsonl
  modified:
    - packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py
    - tests/ingestion/test_handbook_canonical.py
    - tests/ingestion/test_handbook_cleanup.py
    - tests/ingestion/test_process_raw_ingestion_job.py
key-decisions:
  - "Duplicate/update decisions are made at the logical document layer by comparing incoming content_hash against all existing versions for the same document_id + revision_track."
  - "Import reports now expose created_document_ids, updated_document_ids, and skipped_document_ids while keeping document_ids as the created+updated compatibility union."
patterns-established:
  - "Content-driven progression: same document identity plus unchanged normalized content is skipped; changed normalized content produces a new stored version."
  - "Fixture-backed OCR regression: stable and updated handbook provider fixtures now pin duplicate/update behavior to deterministic inputs."
requirements-completed: [ING-01]
duration: inline-session
completed: 2026-03-24
---

# Phase 02 Plan 02: Student Handbook Raw Ingestion Summary

**Handbook re-ingestion now distinguishes created, updated, and skipped logical documents explicitly, backed by stable/update OCR fixtures and passing phase-level verification**

## Performance

- **Duration:** Inline session on 2026-03-24 (not separately time-tracked)
- **Started:** 2026-03-24T10:46:21Z
- **Completed:** 2026-03-24T10:46:21Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Extended import persistence to classify logical handbook imports into `created_document_ids`, `updated_document_ids`, and `skipped_document_ids`.
- Added deterministic `provider-result-stable.jsonl` and `provider-result-updated.jsonl` fixtures so version progression is tied to normalized content changes rather than incidental OCR metadata.
- Proved phase-2 closure with targeted ingestion suites plus the repo-wide unittest baseline.

## Task Commits

This plan was executed inline in the current worktree and has not been split into per-task git commits.

## Files Created/Modified

- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py` - Added logical-document classification and report payload buckets for created/updated/skipped outcomes.
- `tests/fixtures/student_handbook/provider-result-stable.jsonl` - Deterministic unchanged handbook OCR fixture.
- `tests/fixtures/student_handbook/provider-result-updated.jsonl` - Deterministic changed-body handbook OCR fixture.
- `tests/ingestion/test_process_raw_ingestion_job.py` - Added unchanged re-ingestion and changed-content update assertions, including report payload checks.
- `tests/ingestion/test_handbook_cleanup.py` - Locked same-identity/different-version behavior for cleaned handbook documents.
- `tests/ingestion/test_handbook_canonical.py` - Locked title-hash identity stability across fixture updates.

## Decisions Made

- Kept `document_ids` as the created+updated compatibility union so downstream callers do not need a simultaneous migration to the richer report schema.
- Reused registry `list_by_scope()` for cross-version lookup instead of widening the registry contract during Phase 2; correctness mattered more than introducing a premature new interface.

## Deviations from Plan

None - plan executed within the intended Phase 2 scope.

## Issues Encountered

- The new report schema had to stay compatible with existing callers, so the richer buckets were added alongside `document_ids` instead of replacing it.
- Verification continued to require the elevated `uv` path plus `UV_CACHE_DIR=/tmp/uv-cache` in this sandboxed environment.

## User Setup Required

None.

## Next Phase Readiness

- `ING-01` now has repeatable evidence for raw registration, stable logical identity, content-driven version changes, and machine-checkable import outcomes.
- Phase 3 can build processed/chunk/index artifacts on top of explicit document-version semantics instead of implicit happy-path behavior.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/02-student-handbook-raw-ingestion/02-02-SUMMARY.md`.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_canonical.py tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_process_raw_ingestion_job.py -q` passed.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_registry_models.py tests/ingestion/test_processing_pipeline.py tests/ingestion/test_corpus_runtime_profile.py -q` passed.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t .` passed.

---
*Phase: 02-student-handbook-raw-ingestion*
*Completed: 2026-03-24*
