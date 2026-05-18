---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Worker Execution And Operator Projection Plan

## Goal

Plan the shared ingestion-worker execution lifecycle and operator-safe projection layer that compose
the official-web and authenticated-notice adapter plans.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/CONTRACT-STORE-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/OFFICIAL-WEB-ADAPTER-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `apps/app-api/src/modules/official-web-query/service.ts`
- `apps/app-api/src/modules/official-web-projection/service.ts`
- `apps/app-api/src/modules/official-web-execution/service.ts`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/show_authenticated_notice_control_plane_status.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/show_collected_notice_ingest_queue.py`
- `apps/ingestion-worker/README.md`
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`

## Deliverables

- `WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- updated `README.md`
- updated `ROADMAP.md`
- updated `STATE.md`
- updated `.planning/WORKSTREAMS.md`

## Work Items

1. Define canonical execution ownership and compatibility projection ownership.
2. Define claim, heartbeat, retry, terminal and dead-letter semantics.
3. Define shared runner and processor adapter responsibilities.
4. Define `IngestionStep`, `IngestionChildTask` and event write points.
5. Define official-web app-api projection compatibility.
6. Define authenticated-notice queue/operator projection compatibility.
7. Define app-api / panel / telemetry boundaries.
8. Define no-serving-opening gates.
9. Define implementation order and verification plan.
10. Verify planning files with markdownlint and diff checks.

## Acceptance

- No runtime implementation code is changed in Phase 4.
- The plan makes `ingestion_control.ingestion_executions` the canonical execution truth.
- official-web app-api columns and authenticated-notice queue rows are compatibility projections or
  scheduling inputs, not independent terminal truth.
- Operator projection is sanitized and does not require worker local files.
- Panel does not read Postgres, object storage, local worker files or telemetry sinks directly.
- Phase 5 can proceed to implementation readiness review.
