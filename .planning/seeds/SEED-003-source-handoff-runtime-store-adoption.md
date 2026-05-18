---
id: SEED-003
status: dormant
planted: 2026-05-01
planted_during: source-handoff-ingestion-state-machine-design closeout after Phase 10
trigger_when: production adoption of canonical source-handoff execution state is admitted
scope: Large
---

<!-- markdownlint-disable MD013 -->

# SEED-003: Source Handoff Runtime Store Adoption

## Why This Matters

The source-handoff state-machine workstream completed the canonical design and foundation
implementation. It intentionally did not turn that foundation into a production deployment slice.

When operators need canonical source-handoff execution state in a deployed environment, the repo
should open a dedicated adoption workstream rather than reopening design. That follow-up must wire
the existing contract into deployed storage, worker runtime configuration and approved operator
projection surfaces without weakening the boundaries frozen by the closeout.

## When to Surface

**Trigger:** production adoption of canonical source-handoff execution state is admitted.

This seed should be presented during `$gsd-new-milestone` when any of these conditions are true:

- ingestion-worker needs to persist canonical execution state in Postgres instead of in-memory
  tests
- operators need `campus-ingestion-show-source-handoff-executions` against a deployed store
- app-api is explicitly admitted as an operator read projection for source-handoff execution state
- historical official-web worker JSON or authenticated-notice queue rows need canonical backfill
  for operator visibility
- a new source channel needs to join the already frozen source-handoff state machine

## Scope Estimate

**Large** — this is a deployment/runtime adoption slice spanning `packages/ingestion-core`,
`apps/ingestion-worker`, and possibly `apps/app-api` if an operator surface is admitted.

## Breadcrumbs

Related code and planning artifacts:

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/CLOSEOUT.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py`
- `tests/ingestion/test_source_handoff_operator_projection.py`
- `tests/ingestion/test_source_handoff_execution_runner.py`
- `tests/ingestion/test_source_handoff_worker_cli.py`

## Notes

- Implement `PostgresSourceHandoffStore` against the existing `ingestion_control` schema before
  wiring production worker commands.
- Keep `apps/app-api` as the only browser-facing operator API owner if an operator surface is
  admitted.
- Do not let protected-panel-web read Postgres, object storage, worker local files or telemetry
  sinks directly.
- Do not reopen authenticated-notice app-api control-plane ownership unless a separate product
  decision admits that surface.
- Do not publish serving aliases, query-enabled collections or current-truth promotion as part of
  source-handoff runtime adoption.
- Treat telemetry as evidence only; canonical execution truth remains the source-handoff store.
