# Phase 2 Research: Student Handbook Raw Ingestion

**Phase:** 2
**Researched:** 2026-03-24
**Status:** Complete

## Executive Summary

Phase 2 should plan around the current raw-ingestion baseline instead of assuming ingestion is still missing. The repo already has a registered-raw-asset worker entrypoint, object-store key builders, handbook cleanup that derives canonical `document_id` / `version_id`, and tests that cover normalized and `provider_only` handbook flows. The planning gap is therefore not greenfield implementation. It is phase closure: make the raw-asset boundary stricter, preserve handbook document provenance through the normalized path, and explicitly prove duplicate / update / import-report behavior so `ING-01` is satisfied by repeatable evidence rather than by partial code presence.

## Current State Findings

### What is already present

- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` is already the runtime shell for the raw-ingestion path and delegates into ingestion-core without pulling query-serving logic into the worker boundary.
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` already enforces registered raw-asset execution through `RAW_ASSET_ID` + `RAW_VERSION_ID`, reads the raw PDF back from object storage, supports handbook normalized ingestion, and writes asset-level `provider-result.jsonl` plus `structured-full.jsonl`.
- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py` already persists `DocumentRegistryRecord` and `RawAssetRecord` using stable identity fields, shared processed/raw object-store key builders, and import reports.
- `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py` already computes handbook `document_id = handbook:sha1(normalized_title)` and `version_id = v1:sha1(normalized_title + canonical_body)`, which matches the OCR normalization architecture.
- `tests/ingestion/test_process_raw_ingestion_job.py` already covers handbook normalized ingestion, `provider_only`, curriculum split-manifest handling, object-key shapes, and registry writes.

### What still looks phase-relevant

- `process_raw_ingestion_job()` does not currently validate that the selected registered raw asset and the supplied split manifest refer to the same `raw_asset_id`; `SplitManifest` requires it, but the worker path does not enforce the match yet.
- Handbook title cross-checking is still permissive: `_select_title()` can fall back to the manifest title without surfacing OCR-title mismatches, which weakens provenance confidence for the normalized path.
- Duplicate / update behavior is only partially aligned with the phase docs. Skip logic currently happens after structured bytes are produced, and `provider_only` intentionally rewrites `provider-result.jsonl` on repeated runs. That is weaker than the architecture goal of explicit unchanged-vs-changed outcomes.
- `ImportReport` already records `success_count`, `skipped_count`, `failed_count`, `document_ids`, and raw upload/reuse counts, but Phase 2 still needs tests that prove those counters represent duplicate/update outcomes for handbook normalized ingestion rather than only happy-path execution.

## Risk Assessment

### Main risks

1. **Planning from the wrong baseline**
   - Risk: producing plans that reinvent raw-ingestion plumbing already present in `raw_ingestion.py`, `campusrag_ingestion_support.py`, and the worker shell.
   - Mitigation: keep Plan 02-01 focused on boundary tightening and provenance closure, not on introducing a second ingestion path.

2. **Raw/document truth collapse**
   - Risk: convenience edits merge raw-asset registry semantics and document-registry semantics into one persistence layer.
   - Mitigation: keep `RawAssetRecord` / `RawAssetRegistry` and `DocumentRegistryRecord` / `DocumentRegistry` separate, and require plan acceptance criteria to prove both layers remain distinct.

3. **False completion through partial tests**
   - Risk: current tests prove object-key and happy-path behavior but not the duplicate/update semantics promised by the architecture docs.
   - Mitigation: dedicate the second plan to duplicate/version/report fixtures and make `skipped_count`, `document_ids`, and stable/new `version_id` outcomes grep- and test-verifiable.

## Recommended Plan Shape

### Plan 02-01: Raw-asset boundary and provenance closure

Focus on `apps/ingestion-worker`, `raw_ingestion.py`, `campusrag_ingestion_support.py`, `split_manifest.py`, and handbook-ingestion tests.

This plan should:
- keep the worker entry limited to registered `raw_asset_id + raw_version_id` execution
- harden split-manifest/raw-asset compatibility checks
- preserve handbook provenance in the normalized path through object keys, raw page spans, and registry references
- keep `student_handbook` normalized ingestion as the primary acceptance surface without inventing a local file-path compatibility path

### Plan 02-02: Duplicate/version/report verification closure

Focus on `campusrag_ingestion_support.py`, handbook identity helpers, and ingestion tests/fixtures.

This plan should:
- prove stable handbook `document_id` and content-driven `version_id` behavior under re-ingestion
- make unchanged-vs-changed outcomes explicit in registry state and import reports
- keep `provider_only` semantics explicit but prevent it from being treated as sufficient Phase 2 acceptance for handbook normalized truth

## Validation Architecture

Phase 2 already has enough ingestion tests to support tight feedback loops. Validation should stay automation-first and centered on the existing ingestion suites.

### Automated verification layers

- Quick raw-ingestion loop:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_registry_models.py tests/ingestion/test_handbook_canonical.py -q`
- Quick profile/processing regression loop:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/ingestion/test_corpus_runtime_profile.py -q`
- Full phase gate:
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_register_raw_asset.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_registry_models.py tests/ingestion/test_handbook_canonical.py tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_processing_pipeline.py tests/ingestion/test_corpus_runtime_profile.py -q`
  - `uv run --all-packages python -m unittest discover -s tests -t .`

### What must be sampled during execution

- After any raw-ingestion or registry persistence edit: run the quick raw-ingestion loop.
- After any runtime-profile or downstream regression-sensitive edit: run the quick profile/processing regression loop.
- After each plan completes: run the full phase gate.

### Manual verification need

No manual-only verification is required for Phase 2. The acceptance surface is raw/document identity, persistence, and import reporting, all of which can be proven with deterministic tests and code reads.

## Planning Notes

- Keep the phase at exactly two plans, matching `ROADMAP.md`.
- Make Plan 02-02 depend on Plan 02-01 so duplicate/version tests validate the final raw-ingestion boundary rather than an intermediate shape.
- Use exact acceptance strings around:
  - `RAW_ASSET_ID`
  - `RAW_VERSION_ID`
  - `provider-result.jsonl`
  - `structured-full.jsonl`
  - `document_id`
  - `version_id`
  - `skipped_count`
  - `raw_reused_count`

---

*Phase 2 research completed: 2026-03-24*
*Planner should treat current ingestion code as a closure baseline, not as missing infrastructure*
