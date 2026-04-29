---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 4.8
plan: queue-consumer-reimport-path
type: implementation
wave: 1
depends_on:
  - Phase 4.5
  - Phase 4.6
  - Phase 4.7
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 4.8 Plan: Queue Consumer Reimport Path

## Objective

Make the ingestion worker consume `notice_ingest` jobs from the queue and route
them through the same source-truth / document holding / searchable logic that
Phase 4 preview already uses.

This phase proves the ongoing path:

`queue job -> object refs -> source-truth / holding / searchable`

It must not run downstream admission automatically.

## Canonical References

- Phase 4.5 queue contract
- Phase 4.6 queue store and lease runtime
- Phase 4.7 historical enqueue evidence
- Phase 4 reimport preview implementation
- `.planning/workstreams/collected-notice-consumption-replay-closeout/phases/phase-02-chain-contract-and-admission-design/SEARCHABLE-NOTICE-LAYER-SCHEMA.md`

## Inputs

- Queued historical jobs
- Object store refs
- Source-truth / holding / searchable projection code
- Queue lease runtime

## Non-Goals

- No scheduler daemon.
- No collector live polling.
- No downstream target replay.
- No current promotion.
- No query-serving changes.

## Tasks

1. Implement a queue consumer service.
   - Lease jobs by worker id.
   - Load object refs from job payload.
   - Reuse Phase 4 import preparation functions.
   - Complete or fail the queue job with structured reason codes.
2. Support two modes.
   - `--dry-run`: generates source-truth/searchable preview evidence and does not mark jobs succeeded.
   - `--execute`: writes the configured source-truth/searchable state and completes jobs.
3. Add bounded batch controls.
   - `--limit`
   - `--worker-id`
   - `--lease-seconds`
   - `--replay-batch-id`
4. Produce queue-consume evidence.
   - `queue-consume.dry-run.json`
   - `queue-consume.trace.json`
   - `queue-consume-failed-report.json`
   - `searchable-coverage-after-queue-consume.json`
5. Add tests.
   - Dry-run reads leased jobs but does not complete them.
   - Successful execute completes jobs.
   - Missing object refs produce retryable or terminal failure based on error class.
   - Valid consumed jobs produce searchable unit refs.
   - Downstream admission is not called.

## Expected File Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_queue_consumer.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_collected_notice_ingest_queue.py`
- `tests/ingestion/test_collected_notice_queue_consumer.py`
- `tests/ingestion/test_consume_collected_notice_ingest_queue_worker.py`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-04-8-queue-consumer-reimport-path/`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_queue_consumer tests.ingestion.test_consume_collected_notice_ingest_queue_worker
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_reimport_preview tests.ingestion.test_preview_collected_notice_reimport_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_queue_consumer.py apps/ingestion-worker/src/campus_ingestion_worker/consume_collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_queue_consumer.py tests/ingestion/test_consume_collected_notice_ingest_queue_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_queue_consumer.py apps/ingestion-worker/src/campus_ingestion_worker/consume_collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_queue_consumer.py tests/ingestion/test_consume_collected_notice_ingest_queue_worker.py
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-04-8-queue-consumer-reimport-path -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```

## Success Criteria

- Queue jobs can drive reimport without using local filesystem source truth.
- Every successful job has traceable source object refs and searchable output refs.
- Failed jobs remain observable and retryable/dead-letterable.
- Downstream admission remains a separate explicit batch.

## Completion

- Implemented queue consumer core:
  - `packages/ingestion-core/src/campus_ingestion_core/collected_notice_queue_consumer.py`
- Implemented worker CLI:
  - `apps/ingestion-worker/src/campus_ingestion_worker/consume_collected_notice_ingest_queue.py`
- Added focused tests:
  - `tests/ingestion/test_collected_notice_queue_consumer.py`
  - `tests/ingestion/test_consume_collected_notice_ingest_queue_worker.py`
- Generated dry-run evidence:
  - `../../evidence/phase-04-8-queue-consumer-reimport-path/queue-consume.dry-run.json`
  - `../../evidence/phase-04-8-queue-consumer-reimport-path/queue-consume.trace.json`
  - `../../evidence/phase-04-8-queue-consumer-reimport-path/queue-consume-failed-report.json`
  - `../../evidence/phase-04-8-queue-consumer-reimport-path/searchable-coverage-after-queue-consume.json`
