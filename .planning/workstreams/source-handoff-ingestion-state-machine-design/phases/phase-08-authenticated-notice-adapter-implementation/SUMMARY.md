---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Summary: Authenticated-Notice Adapter Implementation

## Result

Phase 8 implemented the authenticated-notice canonical handoff adapter path behind an optional
`source_handoff_store` parameter on the existing run queue consumer.

## Implemented Files

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_handoff_adapter.py`
- `tests/ingestion/test_authenticated_notice_source_handoff_adapter.py`

## Updated Files

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`

## Key Behaviors

- The run queue consumer can now optionally write canonical source-handoff / execution state in
  `execute` mode.
- The adapter maps verified collector run object refs to `SourceRunRef`, `SourceHandoff`,
  bundle/manifest `SourceObjectRef` rows and materialize-only `IngestionExecution`.
- Bundle and manifest object checksum / byte size are verified through the object store before
  handoff verification.
- Failed object verification records `ObjectVerification` evidence and rejects the handoff.
- Source-truth-only success records `verify_objects`, `source_truth_import`, `media_gate` and
  `cleanup_guard` as canonical passed steps.
- Existing child task rows are projected into canonical `IngestionChildTask` rows.
- Canonical execution is completed as `materialized` after the existing queue import / gate checks
  pass.
- Queue rows remain the scheduling inbox and compatibility projection during migration.

## Boundaries Preserved

- No app-api authenticated-notice control-plane route was opened.
- No panel direct database, object storage or local file read was introduced.
- No historical local replay path was triggered.
- No collector frontier or portal authentication behavior was changed.
- No query-serving surface was opened.

## Next Phase

Phase 9 `Worker Execution And Operator Projection Implementation` is ready.

Phase 9 should turn the shared canonical store into operator-facing read projection and shared
runner evidence without making queue rows, worker local JSON or panel reads the source of truth.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_source_handoff_adapter \
  tests.ingestion.test_authenticated_notice_run_queue_consumer \
  tests.ingestion.test_authenticated_notice_run_enqueue \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection
```

Result: `Ran 24 tests ... OK`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_handoff_adapter.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  tests/ingestion/test_authenticated_notice_source_handoff_adapter.py \
  tests/ingestion/test_authenticated_notice_run_queue_consumer.py \
  tests/ingestion/test_authenticated_notice_run_enqueue.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py
```

Result: `All checks passed!`.

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_handoff_adapter.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  tests/ingestion/test_authenticated_notice_source_handoff_adapter.py \
  tests/ingestion/test_authenticated_notice_run_queue_consumer.py \
  tests/ingestion/test_authenticated_notice_run_enqueue.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py
```

Result: `13 files already formatted`.

```bash
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/README.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/ROADMAP.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-08-authenticated-notice-adapter-implementation/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-08-authenticated-notice-adapter-implementation/SUMMARY.md
```

Result: `Summary: 0 error(s)`.

```bash
git diff --check -- \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_handoff_adapter.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py \
  tests/ingestion/test_authenticated_notice_source_handoff_adapter.py
```

Result: no output, exit code `0`.
