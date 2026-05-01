---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Summary: Shared Contract And Store Implementation

## Result

Phase 6 implemented the shared contract/store foundation in `packages/ingestion-core`.

## Implemented Files

- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py`
- `tests/ingestion/test_source_handoff_state_machine.py`
- `tests/ingestion/test_source_handoff_store.py`
- `tests/ingestion/test_source_handoff_postgres.py`
- `tests/ingestion/test_source_handoff_projection.py`

## Key Behaviors

- Canonical models now exist for source run refs, source handoffs, source object refs, object
  verification, ingestion executions, ingestion steps, ingestion child tasks and ingestion events.
- Validators reject local production paths, raw body/html/media/OCR fields and credential fields.
- Required source objects must include sha256 and byte size.
- In-memory store supports handoff idempotency, object verification, verified execution enqueue,
  claim, heartbeat, completion, retryable failure, dead-letter, step, child-task and event writes.
- Postgres bootstrap SQL defines the additive `ingestion_control` schema and all canonical tables.
- Projection helpers cover first official-web and authenticated-notice mappings without importing
  app-api TypeScript or panel code.

## Boundaries Preserved

- No official-web crawler frontier was changed.
- No authenticated-notice portal collection logic was changed.
- No app-api authenticated-notice control-plane route was opened.
- No protected-panel-web direct database/object-storage/local-file read was introduced.
- No query-serving surface was opened.

## Next Phase

Phase 7 `Official-Web Adapter Implementation` is ready.

Phase 7 should wire the current official-web terminal run/artifact/outbox path into the canonical
handoff and execution store while keeping app-api official-web operator projection compatible.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection
```

Result: `Ran 8 tests ... OK`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py
```

Result: `All checks passed!`.

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py
```

Result: `8 files already formatted`.

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
  .planning/workstreams/source-handoff-ingestion-state-machine-design/IMPLEMENTATION-READINESS-REVIEW.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-04-worker-execution-and-operator-projection-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-04-worker-execution-and-operator-projection-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-05-implementation-readiness-review/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-05-implementation-readiness-review/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-06-shared-contract-and-store-implementation/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-06-shared-contract-and-store-implementation/SUMMARY.md
```

Result: `Summary: 0 error(s)`.

```bash
git diff --check -- \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py
```

Result: passed.
