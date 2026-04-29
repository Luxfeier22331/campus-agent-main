---
phase: 03-retrieval-corpus-preparation
status: passed
requirements: [ING-02]
verified_at: 2026-03-24T12:37:02Z
---

# Phase 03 Verification

## Goal

Transform `student_handbook` raw inputs into processed text plus chunk/index artifacts ready for retrieval query-serving.

## Must-Haves

- `student_handbook` normalized ingestion persists canonical document-level `canonical.md` and `document-units.jsonl` artifacts under the expected processed namespace.
- Chunk generation consumes persisted `document-units.jsonl` and preserves stable chunk identity plus evidence-trace metadata.
- Ingestion-core remains the indexing owner through `index_chunks_to_qdrant()` and Qdrant stays the canonical online chunk/index store.
- Retrieval-core stays query-only and consumes indexed metadata plus registry truth without introducing new contracts or supervisor-side repair logic.
- Runtime-profile truth remains the gate for retrieval-enabled collections.

## Evidence

- `apps/ingestion-worker/README.md`
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `tests/ingestion/test_processing_pipeline.py`
- `tests/ingestion/test_corpus_runtime_profile.py`
- `tests/retrieval/test_backend_qdrant.py`
- `.planning/phases/03-retrieval-corpus-preparation/03-01-SUMMARY.md`
- `.planning/phases/03-retrieval-corpus-preparation/03-02-SUMMARY.md`

## Automated Checks

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_processing_pipeline.py -q`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_corpus_runtime_profile.py tests/retrieval/test_backend_qdrant.py tests/ingestion/test_processing_pipeline.py -q`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_corpus_runtime_profile.py tests/retrieval/test_backend_qdrant.py -q`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t .`

## Result

Passed. Phase 3 now has direct evidence that handbook processed artifacts are canonical document-level truth, chunk/index state stays ingestion-owned with Qdrant as the online source of truth, and retrieval-core can consume handbook metadata for evidence shaping without leaking indexing logic across package boundaries.
