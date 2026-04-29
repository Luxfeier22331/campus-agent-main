---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 6R.1a
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.1a Summary: Regulation Owner Text Recovery Mini-Batch

## Result

Phase 6R.1a is complete.

This phase added a no-write regulation owner-text recovery planner and worker.
It consumes Phase 6R.1 regulation admission evidence plus Phase 5 multimodal
candidate inventory, then emits a bounded mini-batch of recovery attempts.

## Evidence

Evidence directory:

`evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch/`

Generated evidence counts:

- Phase 6R.1 `needs_multimodal` entries: `92`
- in-scope file-release regulation entries: `39`
- eligible owner-text recovery attempts: `37`
- selected mini-batch attempts: `10`
- batch-limit deferred attempts: `27`
- gap rows: `2`
- out-of-scope notice-surface deferred rows: `53`

Selected source notice ids:

`620`, `483`, `487`, `485`, `493`, `481`, `564`, `619`, `594`, `509`

## Boundary Decision

This phase still does not make any regulation candidate downstream-ready.

The selected rows only identify which PDF owner documents should be processed
next and where provider response, owner text, layout elements, and searchable
merge input must be written when execution is explicitly enabled later.

Phase 6R.2 remains blocked until at least one selected owner-text recovery
attempt actually produces ready owner text and Phase 6R.1 admission is rerun.

## Code

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_models.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_owner_text_recovery.py`
- `tests/ingestion/test_collected_notice_regulation_owner_text_recovery.py`
- `tests/ingestion/test_preview_collected_notice_regulation_owner_text_recovery_worker.py`

## Follow-Up

The next regulation step is an explicit execution/drain phase for the selected
owner-text attempts. That later phase must call the configured OCR/multimodal
provider and write normalized output refs before rerunning Phase 6R.1.
