# Phase 6: Curriculum Offline Preparation - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** Derived from roadmap, 05.1 outputs, ingestion architecture docs, and current ingestion/rebuild/query-policy code

<domain>
## Phase Boundary

Phase 6 closes `ING-03` for `curriculum/curriculum_plan`.

The scope is narrow:

- make `curriculum_plan` usable as a full offline data-plane path from registered raw asset into processed document artifacts and chunk/index rebuild flows
- keep the curriculum path aligned with the same raw/source-truth/document/chunk conventions already accepted for `student_handbook`
- prove that adding this offline prep does not make `curriculum_plan` query-enabled

The phase does not open curriculum query-serving, does not move curriculum semantics into supervisor/contracts, and does not redesign the `student_handbook` online retrieval baseline.

</domain>

<decisions>
## Implementation Decisions

### Offline preparation boundary
- Phase 6 should treat 05.1 as frozen input truth, not as something to redesign:
  - `curriculum_layout_elements_v3` is the source-truth contract
  - split-manifest logical documents are the pre-chunking boundary
  - `curriculum_plan_semantic_v1` is the accepted runtime chunk profile
- The curriculum acceptance surface is the canonical offline chain:
  - registered raw asset
  - `provider-response.jsonl`
  - `source-truth/layout-elements.jsonl`
  - per-document `document-units.jsonl`
  - chunk generation
  - optional Qdrant indexing through ingestion-core
- Phase 6 should close replay/rebuild and offline-prep ergonomics, not reopen taxonomy or chunk-policy debates.

### Rebuild and replay expectations
- `raw_online_ocr` remains a valid curriculum rebuild/import mode and should keep deleting/rebuilding by `curriculum/curriculum_plan` scope.
- `provider_response_replay` should no longer be handbook-only if the collection already has:
  - persisted provider-response truth
  - a repo-tracked split manifest
  - an explicit runtime chunk profile
- Replay should preserve the same curriculum offline truth as raw OCR import:
  - source-truth asset rewrite under canonical source keys
  - split-manifest-derived document records
  - curriculum document-units suitable for chunking and optional Qdrant indexing
- No curriculum-specific replay path should leak into retrieval-core, supervisor-core, or contracts.

### Query-serving exclusion
- `curriculum_plan` remains `retrieval_enabled = false` and `default_query_enabled = false`.
- Phase 6 must keep explicit regression proof at three layers:
  - retrieval backend rejects disabled corpus/collection scopes
  - supervisor/query policy rejects curriculum scope
  - API-facing entrypoints surface the same denial cleanly
- This exclusion proof is part of Phase 6 acceptance, not a leftover assumption from earlier phases.

### the agent's Discretion
- Exact helper decomposition between `local_rebuild.py` and existing ingestion-core/raw-ingestion helpers, as long as replay logic stays inside ingestion/data-plane boundaries.
- Whether curriculum replay reuses existing private helpers or introduces a small shared helper, provided the canonical artifact chain remains unchanged.
- The exact split between unit-style rebuild tests and integration-style chunk/index tests, as long as the full offline path is machine-checked.

</decisions>

<canonical_refs>
## Canonical References

- `AGENTS.md`
- `README.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/REQUIREMENTS.md`
- `.planning/phases/05.1-curriculum-chunking/05.1-01-SUMMARY.md`
- `.planning/phases/05.1-curriculum-chunking/05.1-02-SUMMARY.md`
- `.planning/phases/05.1-curriculum-chunking/05.1-03-SUMMARY.md`
- `.planning/phases/05.1-curriculum-chunking/05.1-04-SUMMARY.md`
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- `docs/architecture/source-truth-normalization-contract.md`
- `docs/decisions/adr-0001-phase1-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/plans/agentic-rag-foundation.md`
- `configs/ingestion/curriculum/curriculum_plan/README.md`
- `configs/ingestion/curriculum/curriculum_plan/runtime-profile.json`
- `configs/ingestion/curriculum/curriculum_plan/chunk-profile.json`
- `configs/ingestion/curriculum/curriculum_plan/retrieval-profile.json`
- `configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `packages/ingestion-core/src/campus_ingestion_core/curriculum_provider_normalize.py`
- `packages/ingestion-core/src/campus_ingestion_core/curriculum_chunk_units.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `tests/ingestion/test_curriculum_chunking.py`
- `tests/ingestion/test_processing_pipeline.py`
- `tests/ingestion/test_rebuild_local_data.py`
- `tests/retrieval/test_backend_qdrant.py`
- `tests/supervisor/test_supervisor_query_policy.py`
- `tests/api/test_supervisor_api.py`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `process_raw_ingestion_job()` in `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` already supports curriculum `source_truth_only` and split-manifest-driven normalized ingestion.
- `build_indexable_chunks_from_jsonl()` and `build_indexable_chunks_from_record()` in `packages/ingestion-core/src/campus_ingestion_core/process.py` already support `curriculum_plan` chunk construction and explicit runtime-profile resolution.
- `_index_replayed_documents()` in `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py` already indexes replayed documents generically once replay produces `DocumentImportInput` records.
- Query-policy and retrieval-disabled regression tests already exist for curriculum in `tests/retrieval/test_backend_qdrant.py`, `tests/supervisor/test_supervisor_query_policy.py`, and `tests/api/test_supervisor_api.py`.

### Established Patterns
- Runtime truth is config-owned per `corpus/collection`, not hidden in env-only switches.
- Ingestion-core owns replay/rebuild mutation; retrieval-core stays query-only.
- Offline collection preparation may build chunks and Qdrant indexes without becoming query-enabled.
- Tests use fake object stores, in-memory registries, and collection-scoped rebuild assertions rather than real infrastructure.

### Integration Points
- `local_rebuild.py` is the missing curriculum closure point because `provider_response_replay` is still hardcoded to `student_handbook`.
- `raw_ingestion.py` already contains the curriculum source-truth normalization and split-manifest document build logic that replay should mirror rather than re-invent.
- Existing query-policy tests can serve as the Phase 6 regression guard that offline prep does not widen serving scope.

</code_context>

<specifics>
## Specific Ideas

- Auto mode equivalent selection:
  - treat replay/rebuild closure as the main implementation gray area
  - keep query-serving exclusion as an explicit second acceptance surface
- Phase 6 should look more like a closure phase over current curriculum capability than a greenfield implementation phase.
- Preferred verification shape:
  - focused rebuild/import tests for curriculum raw + replay + optional indexing
  - explicit retrieval/supervisor/API tests for continued curriculum exclusion

</specifics>

<deferred>
## Deferred Ideas

- Opening curriculum query-serving is a later phase and must not be smuggled into Phase 6.
- Broader curriculum semantic taxonomy or retrieval ranking changes remain out of scope.
- Any new derived curriculum collections or cross-corpus projection work belong to later roadmap work.

</deferred>

---

*Phase: 06-curriculum-offline-preparation*
*Context gathered: 2026-03-27 via roadmap + 05.1 outputs + current ingestion/query-policy audit*
