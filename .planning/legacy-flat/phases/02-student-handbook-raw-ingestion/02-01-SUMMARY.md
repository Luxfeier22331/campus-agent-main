---
phase: 02-student-handbook-raw-ingestion
plan: "01"
subsystem: ingestion
tags: [ingestion-worker, raw-ingestion, raw-asset-registry, student-handbook, pytest]
requires:
  - phase: 01-contract-and-boundary-guardrails
    provides: supervisor/specialist boundary freeze and phase-1 scope guardrails
provides:
  - canonical handbook raw-asset registration surface in ingestion-worker
  - strict split-manifest to raw-asset identity validation on handbook normalized ingestion
  - handbook manifest-title mismatch rejection before document persistence
affects: [ingestion-core, ingestion-worker, registry, handbook-ingestion-tests]
tech-stack:
  added: []
  patterns: [raw-first registration, raw-asset identity gate, manifest-title verification]
key-files:
  created:
    - apps/ingestion-worker/src/campus_ingestion_worker/register_raw_asset.py
    - tests/ingestion/test_register_raw_asset.py
  modified:
    - apps/ingestion-worker/README.md
    - apps/ingestion-worker/src/campus_ingestion_worker/__init__.py
    - packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py
    - packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py
    - tests/ingestion/test_process_raw_ingestion_job.py
key-decisions:
  - "Canonical handbook onboarding is register_raw_asset -> process_raw_ingestion_job, never a local PDF path shortcut into normalized ingestion."
  - "Manifest/raw-asset mismatches fail fast, while handbook title mismatches are recorded as per-document import failures so unaffected manifest documents can still land."
patterns-established:
  - "Raw-first truth: source PDFs enter the raw bucket and raw-asset registry before OCR execution."
  - "Boundary verification: handbook normalized ingestion validates both raw_asset_id and first-page title trust before document-level persistence."
requirements-completed: [ING-01]
duration: inline-session
completed: 2026-03-24
---

# Phase 02 Plan 01: Student Handbook Raw Ingestion Summary

**Handbook source PDFs now enter through a canonical raw registration surface, and normalized ingestion rejects mismatched raw-asset or title truth before document persistence**

## Performance

- **Duration:** Inline session on 2026-03-24 (not separately time-tracked)
- **Started:** 2026-03-24T10:46:21Z
- **Completed:** 2026-03-24T10:46:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `register_raw_asset()` under `apps/ingestion-worker` to compute `raw_asset_id`, `raw_version_id`, canonical raw object keys, and registry truth before OCR.
- Tightened handbook normalized ingestion so `split_manifest.raw_asset_id` must match the selected registered raw asset and first-page title mismatches are surfaced as machine-checkable import failures.
- Extended ingestion tests to prove raw registration reuse/version semantics plus handbook provenance, parser/embedding metadata, and mismatch handling.

## Task Commits

This plan was executed inline in the current worktree and has not been split into per-task git commits.

## Files Created/Modified

- `apps/ingestion-worker/src/campus_ingestion_worker/register_raw_asset.py` - Canonical raw registration helper and CLI entry.
- `apps/ingestion-worker/src/campus_ingestion_worker/__init__.py` - Exported `register_raw_asset` from the worker package boundary.
- `apps/ingestion-worker/README.md` - Documented the phase-2 canonical `raw_asset_id + raw_version_id` flow.
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` - Added manifest/raw-asset identity enforcement and per-document handbook mismatch handling.
- `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py` - Added reusable handbook title-candidate validation helpers.
- `tests/ingestion/test_register_raw_asset.py` - Locked raw registration identity/version and reuse behavior.
- `tests/ingestion/test_process_raw_ingestion_job.py` - Added handbook raw-asset mismatch, title mismatch, and provenance assertions.

## Decisions Made

- Kept the repo-tracked handbook naming truth from architecture/docs (`provider-response.jsonl`, `layout-elements.jsonl`) instead of reintroducing stale `provider-result` / `structured-full` labels from older planning text.
- Treated split-manifest/raw-asset mismatch as invalid input that must stop the run immediately, while title mismatch remains a per-document failure because the rest of the manifest can still be trusted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Resolved stale plan path and artifact-name drift**
- **Found during:** Task 1 and Task 2
- **Issue:** The plan referenced `configs/ingestion/student_handbook/...` and older artifact labels, but the repo truth lives under `configs/ingestion/regulations/student_handbook/...` and current architecture docs standardize `provider-response.jsonl` / `layout-elements.jsonl`.
- **Fix:** Followed the repo and architecture documents as source of truth and kept the current naming/path boundary intact.
- **Files modified:** `apps/ingestion-worker/README.md`, `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`, tests
- **Verification:** Targeted ingestion tests and phase verification gate passed.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope creep. The deviation kept the implementation aligned with the repository’s accepted architecture instead of stale planning text.

## Issues Encountered

- `uv run --all-packages ...` initially failed inside the sandbox because `uv` needed network/build access for workspace dependencies. Verification succeeded after rerunning with the approved elevated `uv` invocation and `UV_CACHE_DIR=/tmp/uv-cache`.

## User Setup Required

None.

## Next Phase Readiness

- Phase 2 now has a canonical raw registration entrypoint and stronger normalized-ingestion trust checks.
- Duplicate/version/report closure can build on this raw-layer truth without reopening local-file-path compatibility paths.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/02-student-handbook-raw-ingestion/02-01-SUMMARY.md`.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_register_raw_asset.py tests/ingestion/test_process_raw_ingestion_job.py -q` passed.

---
*Phase: 02-student-handbook-raw-ingestion*
*Completed: 2026-03-24*
