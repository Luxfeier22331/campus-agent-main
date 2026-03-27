---
phase: 03-retrieval-corpus-preparation
plan: "01"
subsystem: ingestion
tags: [student-handbook, processed-artifacts, document-units, chunking, pytest]
requires:
  - phase: 02-student-handbook-raw-ingestion
    provides: canonical raw registration and normalized handbook processed artifacts
provides:
  - registry-backed chunk construction from persisted `document-units.jsonl`
  - year-namespaced processed artifact path assertions for handbook normalized ingestion
  - phase-3 evidence that handbook chunk metadata is generated from canonical document-level truth
affects: [ingestion-core, ingestion-worker, registry-backed processing tests]
tech-stack:
  added: []
  patterns: [persisted-artifact lookup, registry-to-chunk bridge, evidence-trace chunk metadata]
key-files:
  created: []
  modified:
    - packages/ingestion-core/src/campus_ingestion_core/process.py
    - tests/ingestion/test_process_raw_ingestion_job.py
key-decisions:
  - "Chunk generation continues to consume persisted document-level `document-units.jsonl` via the document registry instead of introducing a second handbook processing input surface."
  - "Existing document-level `canonical.md` / `document-units.jsonl` object-key persistence remained the source of truth; execution only closed the missing bridge from those persisted artifacts into `IndexableChunk` generation."
patterns-established:
  - "Registry-backed chunk rebuild: a `DocumentRegistryRecord` with `document_units_object_key` is now sufficient to reconstruct retrieval-ready chunks from object storage."
  - "Artifact-path lock: handbook normalized ingestion tests now pin `canonical.md` and `document-units.jsonl` under the document-level year namespace."
requirements-completed: []
duration: inline-session
completed: 2026-03-24
---

# Phase 03 Plan 01: Retrieval Corpus Preparation Summary

**Handbook processed artifacts now feed chunk generation directly from persisted `document-units.jsonl`, with regression coverage that locks the document-level artifact namespace and evidence-trace metadata**

## Performance

- **Duration:** Inline session on 2026-03-24 (not separately time-tracked)
- **Started:** 2026-03-24T12:18:03Z
- **Completed:** 2026-03-24T12:29:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `build_indexable_chunks_from_record()` in `packages/ingestion-core/src/campus_ingestion_core/process.py` so ingestion-core can rebuild retrieval-ready chunks from the canonical `document_units_object_key` stored in the document registry.
- Landed handbook regression tests that prove normalized raw ingestion persists `canonical.md` and `document-units.jsonl` under the expected document-level year namespace.
- Landed handbook regression tests that prove persisted `document-units.jsonl` is sufficient to generate stable chunk IDs plus evidence-trace metadata (`source_chunk_id`, `root_unit_id`, `segment_index`, `segment_total`, `chunk_policy_version`, `cleaning_policy_version`).

## Task Commits

- `0ced397` — `feat: 完成 Phase 03-01 文档单元 chunk 构建闭环`

## Files Created/Modified

- `packages/ingestion-core/src/campus_ingestion_core/process.py` - Added the registry-backed bridge from persisted `document-units.jsonl` to `IndexableChunk` generation.
- `tests/ingestion/test_process_raw_ingestion_job.py` - Added handbook regression coverage for year-scoped processed artifact keys and chunk construction from persisted document units.

## Decisions Made

- Kept the execution inside `packages/ingestion-core`; no retrieval-core, supervisor-core, or contracts-layer shortcut was introduced.
- Treated existing processed artifact persistence as already-canonical phase baseline and closed only the missing registry-to-chunk lookup path required by Phase 3.

## Deviations from Plan

- Task 1 required no new production-path changes during execution because the repo already persisted handbook `canonical.md` / `document-units.jsonl` and corresponding registry fields. Execution instead locked that behavior with explicit regression coverage and then closed the remaining Task 2 bridge.

## Issues Encountered

- The original `03-01` execution attempt through a spawned executor agent did not return a usable completion signal or leave a summary, so execution was resumed inline in the main agent context.
- Git operations required elevated sandbox permissions because `.git/index.lock` could not be created in the default sandbox.

## User Setup Required

None.

## Next Phase Readiness

- Phase 03-02 can now treat `document_units_object_key` as canonical processed truth for handbook indexing instead of re-reading ad hoc payloads.
- The remaining Phase 3 work is to make indexing and retrieval payload semantics explicit around Qdrant/runtime-profile boundaries.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/03-retrieval-corpus-preparation/03-01-SUMMARY.md`.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py -q` passed.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_processing_pipeline.py -q` passed.

---
*Phase: 03-retrieval-corpus-preparation*
*Completed: 2026-03-24*
