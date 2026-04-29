# Phase 3 Research: Retrieval Corpus Preparation

**Phase:** 3
**Researched:** 2026-03-24
**Status:** Complete

## Executive Summary

Phase 3 should plan around an existing but incomplete processing baseline. The repo already has handbook chunking rules, `document-units.jsonl` cleanup/serialization, `IndexableChunk` construction, and Qdrant write helpers. The planning gap is therefore not “invent chunking from scratch.” It is closure: make the canonical raw-first handbook path emit retrieval-ready processed artifacts deterministically, tie chunk/index outputs to document-registry truth, and prove retrieval-core can consume those outputs without new boundary leakage.

## Current State Findings

### What is already present

- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` already rebuilds handbook logical documents from registered raw assets and writes asset/document processed artifacts.
- `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py` and `serialize_handbook_document_units()` already define the cleaned handbook unit layer that Phase 3 should treat as chunking truth.
- `packages/ingestion-core/src/campus_ingestion_core/chunking.py` already freezes the handbook chunk profile and structural split behavior described in the architecture docs.
- `packages/ingestion-core/src/campus_ingestion_core/process.py` already exposes `build_indexable_chunks_from_jsonl()` and `index_chunks_to_qdrant()`, including stable `chunk_id` generation and Qdrant payload metadata.
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` already documents the metadata retrieval-core expects from indexed chunks and the document registry.
- `tests/ingestion/test_processing_pipeline.py` and `tests/retrieval/test_backend_qdrant.py` already cover important parts of chunk payload semantics and retrieval shaping.

### What still looks phase-relevant

- There is no canonical, end-to-end handbook processing closure that proves Phase 2 outputs deterministically become Phase 3 processed/chunk/index truth under the repo-tracked runtime profile.
- Current processing coverage is helper-centric. It does not yet prove that handbook processed artifacts and chunk outputs are persisted or orchestrated as the canonical next step of raw ingestion.
- Index-writing helpers exist, but Phase 3 still needs an explicit plan for how handbook versions map to index updates, stale-version handling, and auditability of derived index artifacts.
- Retrieval payload expectations live in `backend_qdrant.py`, but Phase 3 still needs direct verification that indexed handbook metadata is sufficient for evidence tracing and citation-oriented downstream use.

## Risk Assessment

### Main risks

1. **Canonical path drift**
   - Risk: Phase 3 introduces a second “processing” path that bypasses `layout-elements.jsonl` / `document-units.jsonl` truth and makes handbook indexing depend on ad hoc inputs.
   - Mitigation: keep Plan 03-01 anchored to the existing raw-first handbook artifact chain and persist outputs through shared object-store/document-registry semantics.

2. **Index contract drift**
   - Risk: ingestion-core writes chunk payloads that retrieval-core cannot interpret consistently, forcing Phase 4 to add glue code or metadata repair logic.
   - Mitigation: keep Plan 03-02 explicitly tied to `backend_qdrant.py` payload expectations and retrieval tests.

3. **Stale-version ambiguity**
   - Risk: new handbook versions produce fresh chunks, but stale versions remain query-visible or are filtered through supervisor-side hacks.
   - Mitigation: make version reconciliation an explicit Phase 3 planning concern and keep it grounded in document-registry truth plus ingestion-owned index maintenance.

## Recommended Plan Shape

### Plan 03-01: Processed-text and chunk-generation closure

Focus on `raw_ingestion.py`, handbook cleanup/unit serialization, `process.py`, object-store helpers, and ingestion tests.

This plan should:

- keep the handbook processed artifact chain canonical from Phase 2 outputs into document-level `canonical.md` / `document-units.jsonl`
- make `document-units.jsonl` the direct chunking input for handbook retrieval prep
- prove stable chunk identity plus evidence-trace metadata on generated chunks
- keep table and oversize-split semantics aligned with frozen runtime-truth docs

### Plan 03-02: Retrieval-ready index artifact and metadata closure

Focus on ingestion-owned indexing orchestration, Qdrant payload shape, runtime profiles, and retrieval tests.

This plan should:

- turn generated handbook chunks into canonical retrieval-ready index writes
- keep Qdrant as the online chunk/index truth while allowing optional derived manifests for audit/rebuild
- define explicit version/current-state reconciliation for handbook indexing
- prove retrieval-core can consume the indexed metadata without new contract or supervisor leakage

## Validation Architecture

Phase 3 can stay automation-first. The repo already has focused ingestion and retrieval suites, and the phase acceptance surface is metadata correctness plus deterministic derivation rather than manual UX.

### Automated verification layers

- Quick chunk/processing loop:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/ingestion/test_process_raw_ingestion_job.py -q`
- Quick retrieval/index loop:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/retrieval/test_backend_qdrant.py tests/ingestion/test_corpus_runtime_profile.py -q`
- Full phase gate:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_corpus_runtime_profile.py tests/retrieval/test_backend_qdrant.py -q`
  - `uv run --all-packages python -m unittest discover -s tests -t .`

### What must be sampled during execution

- After any handbook processing or chunk-metadata edit: run the quick chunk/processing loop.
- After any indexing or retrieval-payload edit: run the quick retrieval/index loop.
- After each plan completes: run the full phase gate.

### Manual verification need

No manual-only verification is required for Phase 3. The acceptance surface is processed-artifact truth, chunk metadata, version reconciliation, and retrieval-ready payload semantics, all of which should be machine-checkable.

## Planning Notes

- Keep the phase at exactly two plans, matching `ROADMAP.md`.
- Make Plan 03-02 depend on Plan 03-01 so indexing closes over the final processed/chunk truth rather than over temporary helper behavior.
- Use exact acceptance strings around:
  - `document-units.jsonl`
  - `chunk_id`
  - `source_chunk_id`
  - `root_unit_id`
  - `segment_index`
  - `segment_total`
  - `chunk_policy_version`
  - `cleaning_policy_version`
  - `index_chunks_to_qdrant`
  - `EvidenceBundle`

---

*Phase 3 research completed: 2026-03-24*
*Planner should treat current processing/index code as a closure baseline, not as missing infrastructure*
