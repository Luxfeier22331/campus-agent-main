---
phase: 03-retrieval-corpus-preparation
plan: "02"
subsystem: ingestion-retrieval
tags: [qdrant, retrieval-metadata, runtime-profile, evidence-bundle, pytest]
requires:
  - phase: 03-retrieval-corpus-preparation
    provides: canonical document-level processed artifacts and registry-backed chunk reconstruction
provides:
  - explicit ingestion-owned handbook indexing boundary around `index_chunks_to_qdrant()`
  - retrieval compatibility for `representation` payload alias alongside `revision_track`
  - malformed/unknown metadata skip coverage for handbook evidence shaping
affects: [ingestion-core, retrieval-core, ingestion-worker docs, retrieval tests]
tech-stack:
  added: []
  patterns: [payload alias compatibility, query-only retrieval consumption, Qdrant metadata contract]
key-files:
  created: []
  modified:
    - apps/ingestion-worker/README.md
    - packages/ingestion-core/src/campus_ingestion_core/process.py
    - packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py
    - tests/retrieval/test_backend_qdrant.py
key-decisions:
  - "Qdrant payloads now carry both `revision_track` and `representation`, but the shared contract stays unchanged and retrieval-core remains query-only."
  - "Retrieval metadata gaps fail closed: nodes missing representation/revision metadata or missing registry truth are skipped instead of repaired in supervisor-side code."
patterns-established:
  - "Dual-key payload compatibility: ingestion writes `representation` as an alias for `revision_track`, and retrieval reads either key."
  - "Evidence shaping remains registry-backed: canonical/latest URLs and current-version semantics still come from document registry truth."
requirements-completed: [ING-02]
duration: inline-session
completed: 2026-03-24
---

# Phase 03 Plan 02: Retrieval Corpus Preparation Summary

**Handbook chunk/index metadata is now explicitly aligned between ingestion-core and retrieval-core, with Qdrant remaining the canonical online index and retrieval fail-closing on malformed payloads**

## Performance

- **Duration:** Inline session on 2026-03-24 (not separately time-tracked)
- **Started:** 2026-03-24T12:31:00Z
- **Completed:** 2026-03-24T12:37:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Documented in `apps/ingestion-worker/README.md` that handbook retrieval preparation stays ingestion-owned and writes canonical online chunk/index state through `index_chunks_to_qdrant()`.
- Extended ingestion-core chunk payload metadata so Qdrant nodes carry `representation` as a code-level alias for the existing `revision_track` field, and indexed that payload for remote Qdrant backends.
- Updated retrieval-core to accept either `revision_track` or `representation` when constructing `EvidenceBundle` sources, while continuing to rely on registry truth for `canonical_url`, `latest_url`, and `is_current`.
- Added retrieval regressions covering representation-alias compatibility and safe skipping of malformed or registry-missing metadata.

## Task Commits

- `2736357` — `feat: 完成 Phase 03-02 检索索引元数据收口`

## Files Created/Modified

- `apps/ingestion-worker/README.md` - Clarified the processed-artifact to Qdrant ownership boundary.
- `packages/ingestion-core/src/campus_ingestion_core/process.py` - Added `representation` payload alias and ensured payload indexes include it.
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` - Accepted `representation` as a retrieval-time alias for `revision_track`.
- `tests/retrieval/test_backend_qdrant.py` - Added alias and malformed-metadata skip coverage, and updated payload-index expectations.

## Decisions Made

- Kept the shared contracts on `revision_track`; `representation` is implemented strictly as a payload compatibility alias inside ingestion/retrieval boundaries.
- Preserved the runtime-profile gate as the source of truth for query-enabled collections; no supervisor-side or retrieval-side query exposure toggle was introduced.

## Deviations from Plan

- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` and `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` required no production changes during execution because they already satisfied the plan boundary and runtime-gating requirements. The execution focused on the payload contract and documentation/test closure the phase still lacked.

## Issues Encountered

- The first red test for retrieval alias coverage failed on a test-double setup issue (`QdrantVectorStore` pydantic attribute assignment), not on product behavior; the test harness was corrected before product changes were applied.
- Repository-level unittest verification required `UV_CACHE_DIR=/tmp/uv-cache` in this sandboxed environment because the default `uv` cache location is not writable here.

## User Setup Required

None.

## Next Phase Readiness

- Phase 4 can now consume handbook retrieval hits whose payload metadata is explicit enough for evidence tracing and citation shaping.
- The query path still needs specialist answer semantics, but Phase 3 no longer leaves indexing/metadata ambiguity in the ingestion-to-retrieval handoff.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/03-retrieval-corpus-preparation/03-02-SUMMARY.md`.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_corpus_runtime_profile.py -q` passed.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/retrieval/test_backend_qdrant.py -q` passed.
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_corpus_runtime_profile.py tests/retrieval/test_backend_qdrant.py tests/ingestion/test_processing_pipeline.py -q` passed.

---
*Phase: 03-retrieval-corpus-preparation*
*Completed: 2026-03-24*
