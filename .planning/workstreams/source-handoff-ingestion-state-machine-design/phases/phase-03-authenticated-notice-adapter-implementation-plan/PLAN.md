---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Authenticated-Notice Adapter Implementation Plan

## Goal

Plan the authenticated-notice adapter from verified collector run ledger and run-level queue state
to canonical source handoff and ingestion execution state.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/STATE-MACHINE-DESIGN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/CONTRACT-STORE-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/OFFICIAL-WEB-ADAPTER-PLAN.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`
- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/README.md`
- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/STATE.md`
- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/phases/phase-09-child-task-state-contract-and-processor-profile-consolidation/PLAN.md`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_collector_run_ledger.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_enqueue.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import_sources.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_authenticated_notice_ingest_queue.py`

## Deliverables

- `AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`
- updated `README.md`
- updated `ROADMAP.md`
- updated `STATE.md`
- updated `.planning/WORKSTREAMS.md`

## Work Items

1. Map verified collector run ledger into `SourceRunRef` and `SourceHandoff`.
2. Map bundle, manifest, notice attachment and file-release refs into `SourceObjectRef`.
3. Define object verification import/live-check policy.
4. Map current queue lifecycle into `IngestionExecution`.
5. Map child task and processor profile evidence into `IngestionChildTask` and step state.
6. Preserve `notice` / `file_release` source-surface split.
7. Keep local historical repair explicit and operator-triggered.
8. Define migration order and focused tests.
9. Verify planning files with markdownlint and diff checks.

## Acceptance

- No runtime implementation code is changed in Phase 3.
- The plan does not require app-api to own authenticated-notice control-plane state.
- The plan does not merge collector run ledger, queue and execution into one overloaded state.
- The plan preserves child task / processor profile semantics.
- The plan keeps local historical replay as explicit operator work.
- Phase 4 can proceed to shared worker execution and operator projection planning.
