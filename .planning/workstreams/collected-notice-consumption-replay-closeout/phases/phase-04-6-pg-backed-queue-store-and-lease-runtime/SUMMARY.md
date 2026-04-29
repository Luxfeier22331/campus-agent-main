---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 4.6
---

<!-- markdownlint-disable MD013 -->

# Phase 4.6 Summary: PG-Backed Queue Store And Lease Runtime

## Result

Implemented the first durable `notice_ingest` queue runtime contract for
collected notice consumption. This phase adds queue persistence and lease
semantics only; it does not enqueue historical inventory, consume source
objects, write source-truth/searchable rows, or perform downstream admission.

## Implemented Files

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_memory.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py`
- `tests/ingestion/test_collected_notice_ingest_queue_store.py`
- `tests/ingestion/test_collected_notice_ingest_queue_postgres.py`
- `tests/ingestion/test_show_collected_notice_ingest_queue_worker.py`

## Runtime Semantics

- Queue table: `ingestion_queue.notice_ingest_jobs`.
- Durable identity: unique `idempotency_key`.
- Job payload remains object-ref-only and reuses the Phase 4.5
  `notice_ingest_job.v1` contract.
- `lease_next` claims `queued` jobs or expired `leased` jobs using
  `for update skip locked`.
- Worker ownership is required for `heartbeat`, `complete`,
  `fail_retryable`, and `fail_terminal`.
- Retryable failure increments `attempt_count`; it returns to `queued` until
  `max_attempts`, then enters `dead_letter`.
- Operator status command is read-only and exposes status counts.

## Verification

Focused verification passed:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_queue tests.ingestion.test_collected_notice_ingest_queue_store tests.ingestion.test_collected_notice_ingest_queue_postgres tests.ingestion.test_show_collected_notice_ingest_queue_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue*.py apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_ingest_queue*.py tests/ingestion/test_show_collected_notice_ingest_queue_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue*.py apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_ingest_queue*.py tests/ingestion/test_show_collected_notice_ingest_queue_worker.py
```

## Next Phase

Phase 4.7 should generate historical captured inventory synthetic enqueue
plans. Its default mode remains dry-run and should write only queue jobs when
explicitly executed; it must not write source-truth, searchable, or downstream
state.
