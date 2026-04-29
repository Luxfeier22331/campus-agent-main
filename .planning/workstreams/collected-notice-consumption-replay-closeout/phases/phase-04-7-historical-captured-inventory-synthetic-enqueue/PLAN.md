---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 4.7
plan: historical-captured-inventory-synthetic-enqueue
type: implementation
wave: 1
depends_on:
  - Phase 4.5
  - Phase 4.6
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 4.7 Plan: Historical Captured Inventory Synthetic Enqueue

## Objective

Convert the already captured inventory into `notice_ingest` jobs through the same
queue contract future live collectors will use.

This phase does not re-capture source pages and does not directly import
source-truth. It creates an enqueue plan from the existing run ledger / object
inventory, then optionally writes queue jobs through the Phase 4.6 PG-backed
queue store.

## Canonical References

- Phase 4.5 `NOTICE-INGEST-QUEUE-CONTRACT.md`
- Phase 4.6 queue store plan
- Phase 1 `captured-runs-inventory.json`
- Phase 4 `reimport-plan.dry-run.json`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_reimport_preview.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_reimport.py`

## Inputs

- Captured run inventory
- Object locator audit evidence
- Queue store
- Object refs from captured run bundles and manifests

## Non-Goals

- No direct source-truth/searchable import.
- No local filesystem source truth.
- No source capture or source repair.
- No OCR / multimodal provider calls.
- No downstream admission.

## Tasks

1. Build historical enqueue plan from captured runs.
   - Load selected run refs using existing Phase 4 selection rules.
   - Expand run refs into source-level ingest jobs.
   - Preserve `run_id`, source identity, source surface, and object refs.
2. Produce dry-run evidence.
   - `historical-enqueue-plan.dry-run.json`
   - `historical-enqueue-rejected-deferred-report.json`
   - `enqueue-coverage-report.json`
3. Add reason codes.
   - `collector_run_not_success`
   - `collector_run_not_verified`
   - `missing_capture_manifest_object_ref`
   - `missing_bundle_object_ref`
   - `unsupported_source_surface`
   - `duplicate_idempotency_key`
4. Implement execute mode.
   - `--dry-run` is default.
   - `--execute` writes queue jobs only, not source-truth/searchable.
   - Execute output records inserted/existing/rejected counts.
5. Add tests.
   - Dry-run does not write queue store.
   - Execute enqueues the expected jobs.
   - Duplicate historical replay is idempotent.
   - Missing object refs are rejected with stable reason codes.

## Expected File Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_historical_enqueue.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/enqueue_collected_notice_historical_inventory.py`
- `tests/ingestion/test_collected_notice_historical_enqueue.py`
- `tests/ingestion/test_enqueue_collected_notice_historical_inventory_worker.py`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue/`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_historical_enqueue tests.ingestion.test_enqueue_collected_notice_historical_inventory_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_historical_enqueue.py apps/ingestion-worker/src/campus_ingestion_worker/enqueue_collected_notice_historical_inventory.py tests/ingestion/test_collected_notice_historical_enqueue.py tests/ingestion/test_enqueue_collected_notice_historical_inventory_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_historical_enqueue.py apps/ingestion-worker/src/campus_ingestion_worker/enqueue_collected_notice_historical_inventory.py tests/ingestion/test_collected_notice_historical_enqueue.py tests/ingestion/test_enqueue_collected_notice_historical_inventory_worker.py
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```

## Success Criteria

- Historical captured inventory can be represented as queue jobs without re-capture.
- Dry-run evidence explains every selected, duplicate, rejected, and deferred item.
- Execute mode writes only queue jobs.
- Queue count and evidence count reconcile.

## Completion

- Added historical enqueue planner:
  - `packages/ingestion-core/src/campus_ingestion_core/collected_notice_historical_enqueue.py`
- Added dry-run / execute worker:
  - `apps/ingestion-worker/src/campus_ingestion_worker/enqueue_collected_notice_historical_inventory.py`
- Added focused tests:
  - `tests/ingestion/test_collected_notice_historical_enqueue.py`
  - `tests/ingestion/test_enqueue_collected_notice_historical_inventory_worker.py`
- Generated dry-run evidence:
  - `../../evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue/historical-enqueue-plan.dry-run.json`
  - `../../evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue/historical-enqueue-rejected-deferred-report.json`
  - `../../evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue/enqueue-coverage-report.json`

Dry-run result:

- source-truth candidates: `338`
- planned queue jobs: `338`
- candidate rejected: `0`
- Phase 4 input rejected run refs preserved: `18`
- duplicate idempotency keys: `0`
- by source surface:
  - `notice`: `282`
  - `file_release`: `56`
- coverage verdict: `passed`
- write enabled: `false`
