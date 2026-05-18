---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: Authenticated-Notice Adapter Implementation

## Goal

Wire the existing authenticated-notice run queue consumer into the canonical source-handoff /
ingestion-execution store while keeping `ingestion_queue.notice_ingest_jobs` as the scheduling
inbox and compatibility projection during migration.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-06-shared-contract-and-store-implementation/SUMMARY.md`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_enqueue.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`
- `tests/ingestion/test_authenticated_notice_run_queue_consumer.py`

## Deliverables

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_handoff_adapter.py`
- `tests/ingestion/test_authenticated_notice_source_handoff_adapter.py`
- updates to `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`

## Work Items

1. Add a failing test for source-truth-only queue execution with canonical store enabled.
2. Add authenticated-notice adapter that maps verified run refs to `SourceRunRef`,
   `SourceHandoff`, required bundle/manifest `SourceObjectRef` rows and materialize-only
   `IngestionExecution`.
3. Verify declared bundle and manifest checksum/byte size through the object store before
   handoff verification.
4. Record matched or failed `ObjectVerification` rows and reject the handoff on object
   verification failure.
5. Let `consume_authenticated_notice_ingest_queue` accept optional `source_handoff_store`.
6. Keep legacy queue transition behavior unchanged when no canonical store is supplied.
7. In execute mode with canonical store enabled, write canonical ids into trace rows.
8. Record `verify_objects`, `source_truth_import`, `media_gate` and `cleanup_guard` steps for
   source-truth-only success.
9. Project existing child task rows into canonical `IngestionChildTask` rows.
10. Complete canonical execution as `materialized` only after queue-level import gates pass.
11. Map post-claim retryable / manual-review / terminal queue failures to canonical execution
    failure state without masking the original queue failure.
12. Preserve no app-api authenticated-notice control-plane route and no query-serving opening.

## Acceptance

- Queue compatibility tests still pass.
- Source-truth-only authenticated-notice run can create verified handoff, completed execution,
  passed steps and completed child-task projections.
- Child-task reason codes survive canonical projection.
- Missing / mismatched source objects do not create a verified handoff.
- No app-api authenticated-notice control-plane route is opened.
- No historical local replay path is triggered.
- No query-serving surface is opened.
