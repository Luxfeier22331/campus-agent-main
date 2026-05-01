---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Summary: Worker Execution And Operator Projection Plan

## Result

Phase 4 is complete.

The workstream now has `WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`, which specifies:

- canonical execution ownership in `ingestion_control`
- claim, lease, heartbeat, retry, terminal and dead-letter semantics
- shared runner and processor adapter responsibilities
- `IngestionStep`, `IngestionChildTask` and `ingestion_events` write points
- official-web app-api compatibility projection
- authenticated-notice queue/operator compatibility projection
- operator-safe summary shape and forbidden payload fields
- app-api / protected-panel / telemetry boundaries
- no-serving-opening gates
- implementation order and focused verification commands

## Key Decisions

- `ingestion_control.ingestion_executions` becomes canonical execution truth.
- official-web `ingestion_execution_*` fields remain app-api-owned compatibility projections.
- authenticated-notice queue rows remain scheduling inbox / compatibility projection during
  migration.
- worker local JSON, operations dirs and trace files remain debug/evidence only.
- protected-panel-web must continue to consume app-api APIs only; it does not read shared execution
  tables, object storage or telemetry sinks directly.
- telemetry events are evidence and debugging signals, not canonical state.
- no serving surface opens as part of the shared state-machine implementation.

## Verification

```bash
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/README.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/REQUIREMENTS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/ROADMAP.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE-MACHINE-DESIGN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/CONTRACT-STORE-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/OFFICIAL-WEB-ADAPTER-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/AUTHENTICATED-NOTICE-ADAPTER-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-04-worker-execution-and-operator-projection-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-04-worker-execution-and-operator-projection-plan/SUMMARY.md
```

Result: `Summary: 0 error(s)`.

```bash
git diff --check -- \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design
```

Result: passed.
