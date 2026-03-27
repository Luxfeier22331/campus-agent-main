---
phase: 02-student-handbook-raw-ingestion
status: passed
requirements: [ING-01]
verified_at: 2026-03-24T10:46:21Z
---

# Phase 02 Verification

## Goal

Ingest `student_handbook` sources into raw storage with stable identity and version metadata that downstream processing can trust.

## Must-Haves

- `register_raw_asset` registers handbook source PDFs into the canonical raw bucket and raw-asset registry.
- `process_raw_ingestion_job` executes only from registered `raw_asset_id + raw_version_id`.
- Split-manifest and handbook title validation reject untrusted normalized imports.
- Re-ingestion distinguishes unchanged handbook content from changed handbook content.
- Import reports expose machine-checkable created/updated/skipped outcomes.

## Evidence

- `apps/ingestion-worker/src/campus_ingestion_worker/register_raw_asset.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py`
- `tests/fixtures/student_handbook/provider-result-stable.jsonl`
- `tests/fixtures/student_handbook/provider-result-updated.jsonl`
- `tests/ingestion/test_register_raw_asset.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `tests/ingestion/test_handbook_canonical.py`
- `tests/ingestion/test_handbook_cleanup.py`

## Automated Checks

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_register_raw_asset.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_registry_models.py tests/ingestion/test_handbook_canonical.py tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_processing_pipeline.py tests/ingestion/test_corpus_runtime_profile.py -q`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t .`

## Result

Passed. Phase 2 now has direct evidence for canonical raw registration, handbook logical identity/version progression, and machine-checkable duplicate/update reporting.
