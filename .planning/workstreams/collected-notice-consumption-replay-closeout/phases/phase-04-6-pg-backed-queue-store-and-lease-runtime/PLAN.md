---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 4.6
plan: pg-backed-queue-store-and-lease-runtime
type: implementation
wave: 1
depends_on:
  - Phase 4.5
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 4.6 Plan: PG-Backed Queue Store And Lease Runtime

## Objective

Implement the first durable notice ingest queue in shared PostgreSQL. This is an
ingestion runtime queue, not a downstream target queue and not a scheduler.

The runtime must support:

- deterministic enqueue with idempotency
- worker leasing with expiry
- heartbeat
- success / retryable failure / terminal failure
- dead-letter visibility
- dry-run-safe tests and evidence

## Canonical References

- Phase 4.5 `NOTICE-INGEST-QUEUE-CONTRACT.md`
- `packages/ingestion-core/src/campus_ingestion_core/postgres_runtime.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_store_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_models.py`
- `tests/ingestion/authenticated_notice_closeout_async_store_locking_suite.py`
- `tests/ingestion/test_postgres_runtime.py`

## Inputs

- Notice ingest job DTO and validation from Phase 4.5
- Shared PostgreSQL runtime configuration
- Existing closeout lease/heartbeat patterns

## Non-Goals

- No Redis/SQS/Kafka introduction.
- No scheduler or daemon lifecycle.
- No direct source-truth/searchable writes.
- No downstream admission or target materialization.
- No collector live rollout.

## Tasks

1. Add a queue table schema.
   - Required columns:
     - `job_id`
     - `idempotency_key`
     - `job_kind`
     - `source_channel`
     - `source_surface`
     - `source_identity`
     - `capture_id`
     - `capture_manifest_object_ref`
     - `content_hash`
     - `run_id`
     - `enqueue_source`
     - `replay_batch_id`
     - `priority`
     - `status`
     - `attempt_count`
     - `max_attempts`
     - `leased_by`
     - `lease_expires_at`
     - `last_error_code`
     - `last_error_message`
     - `created_at`
     - `updated_at`
   - Unique key: `idempotency_key` for active job identity.
2. Implement store operations.
   - `enqueue`
   - `enqueue_many`
   - `lease_next`
   - `heartbeat`
   - `complete`
   - `fail_retryable`
   - `fail_terminal`
   - `dead_letter`
   - `list_status_counts`
3. Implement locking semantics.
   - Lease only `queued` or expired `leased`.
   - Complete/fail only by current lease holder.
   - Retryable failure increments attempt count and returns to `queued` until max attempts.
4. Add in-memory store for unit tests where useful.
5. Add focused tests.
   - Duplicate enqueue returns existing active job.
   - Priority ordering is stable.
   - Expired lease can be reclaimed.
   - Non-owner heartbeat/complete/fail is rejected.
   - Max attempts moves job to `dead_letter`.
6. Add queue status CLI or worker command in `apps/ingestion-worker`.
   - Read-only status counts.
   - Optional `--json` output for evidence.

## Expected File Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_memory.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py`
- `tests/ingestion/test_collected_notice_ingest_queue_store.py`
- `tests/ingestion/test_collected_notice_ingest_queue_postgres.py`
- `tests/ingestion/test_show_collected_notice_ingest_queue_worker.py`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_queue_store tests.ingestion.test_show_collected_notice_ingest_queue_worker
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_queue_postgres
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue*.py apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_ingest_queue*.py tests/ingestion/test_show_collected_notice_ingest_queue_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue*.py apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_ingest_queue*.py tests/ingestion/test_show_collected_notice_ingest_queue_worker.py
pnpm docs:lint
git diff --check
```

## Success Criteria

- Queue persistence and lease runtime are deterministic and test-covered.
- Replaying the same captured object does not create duplicate active work.
- Worker crash recovery is possible through lease expiry.
- Operators can see queued/leased/succeeded/failed/dead-letter counts without touching downstream state.

## Completion

- Added shared queue runtime DTOs, errors, status count helpers, lease ownership
  validation, and job payload reconstruction:
  - `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- Added in-memory queue runtime for deterministic behavior tests:
  - `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_memory.py`
- Added shared PostgreSQL queue store:
  - `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- Added read-only worker status command:
  - `apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py`
- Added focused tests:
  - `tests/ingestion/test_collected_notice_ingest_queue_store.py`
  - `tests/ingestion/test_collected_notice_ingest_queue_postgres.py`
  - `tests/ingestion/test_show_collected_notice_ingest_queue_worker.py`

Implemented semantics:

- `idempotency_key` is unique and duplicate enqueue returns the existing job.
- `lease_next` only claims `queued` jobs or expired `leased` jobs, ordered by
  `priority`, `created_at`, then `job_id`.
- `heartbeat`, `complete`, `fail_retryable`, and `fail_terminal` require the
  current lease holder.
- Retryable failure increments `attempt_count`, returns to `queued` until
  `max_attempts`, then moves to `dead_letter`.
- Queue status CLI only reads counts and reports `write_enabled=false`.
