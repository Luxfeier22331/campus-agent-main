---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Summary: Official-Web Adapter Implementation

## Result

Phase 7 implemented the official-web canonical handoff adapter path behind an optional
`source_handoff_store` parameter.

## Implemented Files

- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_source_handoff_adapter.py`
- `tests/ingestion/test_official_web_source_handoff_adapter.py`

## Updated Files

- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`

## Key Behaviors

- official-web consumer can now optionally write canonical source-handoff / execution state.
- The adapter maps terminal payload facts to `SourceRunRef`, `SourceHandoff` and required object
  refs.
- Declared `source_truth_bundle` checksum and byte size are verified before execution.
- Bundle page manifest and content-block object refs are expanded and verified as required source
  objects.
- `verify_objects`, replay input materialization, source-truth import, projection validation and
  chunk audit are recorded as canonical steps for stage-only runs.
- Canonical execution is completed before app-api receives staged/promoted callback.
- app-api execution callback still uses the same payload shape, but `executionRef` is the canonical
  execution id when canonical store is enabled.
- Legacy local JSON status writes remain as compatibility/debug evidence.

## Boundaries Preserved

- No official-web crawler frontier or crawl policy was changed.
- No authenticated-notice adapter was wired.
- No protected-panel-web direct database/object-storage/local-file read was introduced.
- No query-serving surface was opened.
- No promotion occurs unless the existing explicit promotion gate is enabled.

## Next Phase

Phase 8 `Authenticated-Notice Adapter Implementation` is ready.

Phase 8 should wire verified authenticated-notice collector run ledger / queue facts into the
canonical handoff and execution store while keeping queue compatibility during migration.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_official_web_source_handoff_adapter \
  tests.ingestion.official_web_handoff_consumer_staging_suite \
  tests.ingestion.official_web_handoff_consumer_promotion_gate_suite \
  tests.ingestion.official_web_handoff_consumer_failure_suite \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection
```

Result: `Ran 19 tests ... OK`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_source_handoff_adapter.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py \
  tests/ingestion/test_official_web_source_handoff_adapter.py
```

Result: `All checks passed!`.

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_source_handoff_adapter.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py \
  tests/ingestion/test_official_web_source_handoff_adapter.py
```

Result: `11 files already formatted`.
