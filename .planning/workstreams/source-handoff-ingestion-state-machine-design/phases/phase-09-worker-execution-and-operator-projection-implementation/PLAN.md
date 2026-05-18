---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Plan: Worker Execution And Operator Projection Implementation

## Goal

Turn the canonical source-handoff store from Phase 6-8 into a worker/operator usable execution
surface without making queue rows, worker local JSON, panel reads or telemetry sinks the source of
truth.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-08-authenticated-notice-adapter-implementation/SUMMARY.md`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_handoff_adapter.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`
- `apps/ingestion-worker/pyproject.toml`

## Deliverables

- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_no_serving_gate.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py`
- focused tests for projection, runner, worker functions and no-serving gate

## Work Items

1. Add failing tests for operator-safe per-execution projection.
2. Add failing tests for shared execution runner claim / running / complete lifecycle.
3. Add failing tests for worker read and consume function shells.
4. Add failing tests for no-serving-opening drift detection.
5. Extend `SourceHandoffStore` with canonical operator record snapshots and running transition.
6. Implement operator projection from canonical handoff, object verification, execution, step and
   child-task rows.
7. Sanitize projection refs so debug/local-only refs do not become operator truth.
8. Implement shared runner helper for claim, mark-running, processor dispatch, step completion,
   terminal completion and retry/terminal failure mapping.
9. Add worker CLI shells that fail closed unless an explicit in-memory smoke mode is requested.
10. Register worker console scripts.
11. Keep official-web app-api and authenticated-notice queue compatibility behavior unchanged.
12. Keep app-api/panel/authenticated-notice operator route surfaces unopened.

## Acceptance

- Operator projection can show per-execution handoff, object, step and child-task summaries without
  raw payloads or local-file truth.
- Shared runner uses canonical execution claim/running/complete/fail transitions.
- Worker consume/show functions can be exercised without reading worker local JSON.
- No-serving-opening gate fails on query-enabled, serving-alias or implicit promotion drift.
- Existing Phase 6-8 source-handoff and adapter tests still pass.
- No app-api authenticated-notice control-plane route is opened.
- No panel direct database/object/local-file read is introduced.
- No query-serving surface is opened.
