---
phase: 06-curriculum-offline-preparation
status: passed
requirements: [ING-03]
verified_at: 2026-04-02T13:52:00Z
---

# Phase 06 Verification

## Goal

Prepare `curriculum_plan` raw, processed, and chunk outputs as an offline data-plane path before the later profile-driven serving-surface refactor.

## Must-Haves

- `curriculum_plan` documents can be imported into the offline ingestion path.
- `curriculum_plan` can be cleaned and chunked using the same data-plane conventions as `student_handbook`.
- No production query-serving route yet exposes `curriculum_plan` at Phase 6 closeout.
- Replay/rebuild remains an offline data-plane capability and does not widen the serving surface.

## Evidence

- `.planning/phases/06-curriculum-offline-preparation/06-01-SUMMARY.md`
- `.planning/phases/06-curriculum-offline-preparation/06-02-SUMMARY.md`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `configs/ingestion/curriculum/curriculum_plan/README.md`
- `tests/ingestion/test_rebuild_local_data.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `tests/supervisor/test_supervisor_query_policy.py`
- `tests/retrieval/test_backend_qdrant.py`
- `tests/api/test_supervisor_api.py`

## Automated Checks

- Historical phase-close evidence from the retained summaries:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_rebuild_local_data.py tests/ingestion/test_process_raw_ingestion_job.py -q`
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_rebuild_local_data.py tests/ingestion/test_process_raw_ingestion_job.py tests/retrieval/test_backend_qdrant.py tests/supervisor/test_supervisor_query_policy.py tests/api/test_supervisor_api.py -q`
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t .`
- 2026-04-02 worktree-local verification rerun:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.ingestion.test_rebuild_local_data tests.ingestion.test_process_raw_ingestion_job tests.supervisor.test_supervisor_query_policy tests.retrieval.test_backend_qdrant`

## Requirement Mapping

- `ING-03`: closed by the two retained plans together:
  - `06-01` closed raw/processed/chunk replay/rebuild support inside the offline ingestion path
  - `06-02` proved the query-serving surface still excludes `curriculum_plan` after offline preparation

## Result

Passed. The worktree now retains an explicit verification record for `ING-03`, and the 2026-04-02 rerun confirmed that curriculum replay/rebuild remains green while the query surface stays fail-closed.
