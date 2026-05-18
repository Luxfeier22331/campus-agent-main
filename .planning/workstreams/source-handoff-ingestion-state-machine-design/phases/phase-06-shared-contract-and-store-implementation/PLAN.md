---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Shared Contract And Store Implementation

## Goal

Implement the shared source-handoff / ingestion-execution contract, in-memory store, Postgres
bootstrap and projection helper foundation before wiring source-specific adapters.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/CONTRACT-STORE-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/OFFICIAL-WEB-ADAPTER-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/IMPLEMENTATION-READINESS-REVIEW.md`
- `packages/ingestion-core/AGENTS.md`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_memory.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_collector_run_ledger.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py`

## Deliverables

- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py`
- `tests/ingestion/test_source_handoff_state_machine.py`
- `tests/ingestion/test_source_handoff_store.py`
- `tests/ingestion/test_source_handoff_postgres.py`
- `tests/ingestion/test_source_handoff_projection.py`

## Work Items

1. Add failing tests for canonical model validation, forbidden payload rejection and transition
   invariants.
2. Add failing tests for in-memory handoff idempotency, execution claim, heartbeat, completion and
   retry exhaustion.
3. Add failing tests for additive Postgres bootstrap SQL shape.
4. Add failing tests for official-web and authenticated-notice projection helpers.
5. Implement canonical dataclasses, constants, validators and helper methods.
6. Implement in-memory store with handoff, verification, execution, step, child-task and event
   operations.
7. Implement additive Postgres schema bootstrap SQL for `ingestion_control`.
8. Implement pure projection helpers for official-web and authenticated-notice.
9. Verify focused tests, ruff and format gates.
10. Update workstream state and registry.

## Acceptance

- Shared contract/store tests pass.
- Validators reject local paths, raw body fields, raw HTML/OCR/media fields and credential fields.
- Required object refs require hash and byte size.
- Only verified handoffs can enqueue executions.
- Execution claim, heartbeat, completion, retryable failure and dead-letter behavior are covered.
- Postgres bootstrap is additive and declares canonical `ingestion_control` tables.
- Projection helpers do not import app-api TypeScript or panel code.
- No source-specific collector frontier is changed.
- No app-api authenticated-notice route is opened.
- No query-serving surface is opened.
