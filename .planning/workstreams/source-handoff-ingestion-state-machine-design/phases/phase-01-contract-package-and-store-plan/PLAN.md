---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Contract Package And Store Plan

## Goal

Turn Phase 0 state-machine design into an implementation-ready contract/store plan without editing
collector internals or worker runtime paths.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/STATE-MACHINE-DESIGN.md`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_models.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`
- `apps/app-api/src/db/schema/official-web.ts`

## Deliverables

- `CONTRACT-STORE-PLAN.md`
- updated `ROADMAP.md`
- updated `STATE.md`
- updated `.planning/WORKSTREAMS.md`

## Work Items

1. Identify exact `packages/ingestion-core` module layout for canonical source handoff models and
   stores.
2. Define the first Postgres logical schema and table set under `ingestion_control`.
3. Define official-web compatibility projection from app-api dispatch/execution columns.
4. Define authenticated-notice compatibility projection from queue and child-task states.
5. Define implementation order and focused tests.
6. Verify planning files with markdownlint and diff checks.

## Acceptance

- No implementation code is changed.
- No source-specific collector internals are changed.
- Plan defines exact module paths and table names.
- Plan defines current-state compatibility projections.
- Plan defines tests that must fail/pass in the implementation phase.
