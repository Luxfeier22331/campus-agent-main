---
phase: 06-curriculum-offline-preparation
plan: "01"
subsystem: ingestion-rebuild
tags: [curriculum, replay, rebuild, offline-only]
requires:
  - phase: 06-curriculum-offline-preparation
    provides: frozen curriculum offline boundary from 05.1
provides:
  - curriculum provider-response replay support
  - documented offline rebuild path for curriculum_plan
  - focused curriculum rebuild regression coverage
affects: [ingestion-core, configs, tests]
tech-stack:
  added: []
  patterns: [replay from canonical provider truth, reuse canonical split helper, offline-only rebuild]
key-files:
  created:
    - .planning/phases/06-curriculum-offline-preparation/06-01-SUMMARY.md
  modified:
    - packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py
    - configs/ingestion/curriculum/curriculum_plan/README.md
    - tests/ingestion/test_rebuild_local_data.py
key-decisions:
  - "Curriculum replay now reuses the canonical split-manifest document builder instead of inventing a replay-only document contract."
  - "A collection-specific default replay source filename is acceptable inside ingestion-core as long as serving scope does not change."
duration: inline
completed: 2026-03-27
---

# Phase 06 Plan 01 Summary

**Completed the curriculum offline rebuild loop from persisted provider/source-truth artifacts**

## Accomplishments

- Extended `replay_provider_response_rebuild()` so `curriculum_plan` can rebuild from canonical `provider-response.jsonl` plus repo-tracked split manifest without re-running OCR.
- Kept replay inside ingestion-core by reusing the existing curriculum split-manifest document helper and the shared indexing path.
- Updated the collection README to describe `REBUILD_IMPORT_MODE=provider_response_replay` as an offline-only preparation surface.
- Added focused rebuild tests for curriculum default replay inputs, curriculum replay document regeneration, and curriculum-specific Qdrant reset targeting.

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_rebuild_local_data.py tests/ingestion/test_process_raw_ingestion_job.py -q`

## Self-Check: PASSED

- Curriculum replay no longer requires fresh OCR.
- The replay path reuses canonical source-truth and split-manifest boundaries.
- No supervisor/query-serving package was touched.
