---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Summary: Worker Execution And Operator Projection Implementation

## Result

Phase 9 implemented the shared canonical execution runner helpers, operator-safe projection and
worker consume/show shells for source-handoff execution state.

## Implemented Files

- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_no_serving_gate.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py`
- `tests/ingestion/test_source_handoff_operator_projection.py`
- `tests/ingestion/test_source_handoff_execution_runner.py`
- `tests/ingestion/test_source_handoff_worker_cli.py`
- `tests/ingestion/test_source_handoff_no_serving_gate.py`

## Updated Files

- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`
- `apps/ingestion-worker/pyproject.toml`

## Key Behaviors

- `SourceHandoffStore` now exposes canonical operator records and `mark_execution_running`.
- Operator projection returns per-execution handoff, required object verification, execution, step
  and child-task summaries.
- Operator projection aggregates safe output refs while dropping debug-only refs without canonical
  object identifiers.
- Shared runner claims canonical executions, marks them running, dispatches by
  `processor_profile`, records passed steps and completes/fails through store-backed lifecycle
  transitions.
- Worker consume/show functions operate on `SourceHandoffStore`; CLI entrypoints fail closed unless
  `--empty-in-memory` smoke mode is explicitly requested.
- No-serving gate fails on query-enabled, serving-alias or implicit current-truth promotion drift.

## Boundaries Preserved

- No app-api authenticated-notice control-plane route was opened.
- No protected-panel-web direct database, object storage or local file read was introduced.
- No collector frontier or portal authentication behavior was changed.
- No telemetry sink was made canonical truth.
- No query-serving surface was opened.

## Next Phase

Phase 10 `Closeout Gate And Migration Readiness` is ready.

Phase 10 should decide whether this workstream is ready to close, needs Postgres-backed runtime
store implementation, or should defer database-backed operator adoption to a later deployment
workstream.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_source_handoff_operator_projection \
  tests.ingestion.test_source_handoff_execution_runner \
  tests.ingestion.test_source_handoff_worker_cli \
  tests.ingestion.test_source_handoff_no_serving_gate \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection \
  tests.ingestion.test_official_web_source_handoff_adapter \
  tests.ingestion.test_authenticated_notice_source_handoff_adapter \
  tests.ingestion.test_authenticated_notice_run_queue_consumer \
  tests.ingestion.test_authenticated_notice_run_enqueue
```

Result: `Ran 30 tests ... OK`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_no_serving_gate.py \
  apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py \
  apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py \
  tests/ingestion/test_source_handoff_operator_projection.py \
  tests/ingestion/test_source_handoff_execution_runner.py \
  tests/ingestion/test_source_handoff_worker_cli.py \
  tests/ingestion/test_source_handoff_no_serving_gate.py
```

Result: `All checks passed!`.

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_no_serving_gate.py \
  apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py \
  apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py \
  tests/ingestion/test_source_handoff_operator_projection.py \
  tests/ingestion/test_source_handoff_execution_runner.py \
  tests/ingestion/test_source_handoff_worker_cli.py \
  tests/ingestion/test_source_handoff_no_serving_gate.py
```

Result: `10 files already formatted`.

```bash
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/README.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/ROADMAP.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-09-worker-execution-and-operator-projection-implementation/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-09-worker-execution-and-operator-projection-implementation/SUMMARY.md
```

Result: `Summary: 0 error(s)`.

```bash
git diff --check -- \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_no_serving_gate.py \
  apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py \
  apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py \
  apps/ingestion-worker/pyproject.toml \
  tests/ingestion/test_source_handoff_operator_projection.py \
  tests/ingestion/test_source_handoff_execution_runner.py \
  tests/ingestion/test_source_handoff_worker_cli.py \
  tests/ingestion/test_source_handoff_no_serving_gate.py
```

Result: no output, exit code `0`.
