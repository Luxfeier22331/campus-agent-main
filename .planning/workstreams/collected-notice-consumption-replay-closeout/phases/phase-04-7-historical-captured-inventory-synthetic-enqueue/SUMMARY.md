---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 4.7
---

<!-- markdownlint-disable MD013 -->

# Phase 4.7 Summary: Historical Captured Inventory Synthetic Enqueue

## Result

Generated a dry-run historical enqueue plan from the Phase 4 reimport manifest.
The plan represents already captured notices as Phase 4.5 `notice_ingest`
queue jobs and does not re-capture pages, write source-truth/searchable state,
call OCR/multimodal providers, or perform downstream admission.

## Implemented Files

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_historical_enqueue.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/enqueue_collected_notice_historical_inventory.py`
- `tests/ingestion/test_collected_notice_historical_enqueue.py`
- `tests/ingestion/test_enqueue_collected_notice_historical_inventory_worker.py`

## Evidence

Generated under:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue/`

Files:

- `historical-enqueue-plan.dry-run.json`
- `historical-enqueue-rejected-deferred-report.json`
- `enqueue-coverage-report.json`

Dry-run counts:

- source-truth candidates: `338`
- planned queue jobs: `338`
- candidate rejected: `0`
- Phase 4 input rejected run refs preserved: `18`
- duplicate idempotency keys: `0`
- `notice`: `282`
- `file_release`: `56`
- coverage verdict: `passed`
- write enabled: `false`

## Execute Boundary

`--execute` is implemented but was not run in this phase. Execute mode writes
queue jobs only through the Phase 4.6 queue store and reports inserted/existing
counts. It does not write source-truth, searchable, OCR, or downstream state.

## Next Phase

Phase 4.8 should implement the queue consumer reimport path: lease
`notice_ingest` jobs, consume object refs, and route them through the existing
source-truth / holding / searchable reimport path.
