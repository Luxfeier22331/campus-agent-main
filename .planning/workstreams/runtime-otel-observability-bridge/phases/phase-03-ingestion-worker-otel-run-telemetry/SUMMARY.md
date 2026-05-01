---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Ingestion Worker OTel Run Telemetry

Phase 3 is complete.

## Implemented

- Added `apps/ingestion-worker/src/campus_ingestion_worker/ingestion_run_telemetry.py`.
- Added `INGESTION_RUN_TELEMETRY_JSONL_PATH` as the worker-owned local/debug runtime event sink.
- Added sanitized `ingestion.run.started`, `ingestion.run.completed` and
  `ingestion.run.failed` event emission to:
  - `campus_ingestion_worker.prepare_registry_scope_chunks`
  - `campus_ingestion_worker.release_registry_scope`
  - `campus_ingestion_worker.release_index`
- Preserved ingestion-core vendor neutrality. No OTel/Sentry/Axiom imports were added to
  `packages/ingestion-core`.
- Event attributes are allowlisted run-level summaries only:
  - operation/stage/run/scope/status/duration
  - document/chunk/point counts
  - embedding cache/provider counts
  - validation/release/audit status
  - failure kind for failed runs
- Raw canonical body, chunk body, OCR raw text, source credential, auth material and DB URL fields
  are excluded by construction.
- Worker stdout now includes aggregate `telemetry.status`; telemetry export failure reports
  `status=degraded` and `failure_kind=telemetry_export_failed` without failing the job.
- Updated `docs/runbooks/index-release-runbook.md` with ingestion run telemetry smoke steps.
- Updated `docs/reference/runtime-otel-telemetry-taxonomy.md` with Phase 3 ingestion attributes.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_release_registry_scope_worker \
  tests.ingestion.test_release_index_worker \
  tests.ingestion.ingestion_worker_run_telemetry_suite -q
```

Observed result: `Ran 9 tests ... OK`.

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_index_release \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release -q
```

Observed result: `Ran 45 tests ... OK`.

```bash
uv run --all-packages ruff check \
  apps/ingestion-worker/src/campus_ingestion_worker/ingestion_run_telemetry.py \
  apps/ingestion-worker/src/campus_ingestion_worker/prepare_registry_scope_chunks.py \
  apps/ingestion-worker/src/campus_ingestion_worker/release_registry_scope.py \
  apps/ingestion-worker/src/campus_ingestion_worker/release_index.py \
  tests/ingestion/ingestion_worker_run_telemetry_suite.py \
  tests/ingestion/test_ingestion_worker_run_telemetry.py
```

Observed result: `All checks passed!`.

```bash
uv run --all-packages ruff format --check \
  apps/ingestion-worker/src/campus_ingestion_worker/ingestion_run_telemetry.py \
  apps/ingestion-worker/src/campus_ingestion_worker/prepare_registry_scope_chunks.py \
  apps/ingestion-worker/src/campus_ingestion_worker/release_registry_scope.py \
  apps/ingestion-worker/src/campus_ingestion_worker/release_index.py \
  tests/ingestion/ingestion_worker_run_telemetry_suite.py \
  tests/ingestion/test_ingestion_worker_run_telemetry.py
```

Observed result: `6 files already formatted`.

```bash
pnpm exec markdownlint-cli2 \
  docs/reference/runtime-otel-telemetry-taxonomy.md \
  docs/runbooks/index-release-runbook.md \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/runtime-otel-observability-bridge/README.md \
  .planning/workstreams/runtime-otel-observability-bridge/ROADMAP.md \
  .planning/workstreams/runtime-otel-observability-bridge/STATE.md \
  .planning/workstreams/runtime-otel-observability-bridge/phases/phase-03-ingestion-worker-otel-run-telemetry/PLAN.md \
  .planning/workstreams/runtime-otel-observability-bridge/phases/phase-03-ingestion-worker-otel-run-telemetry/SUMMARY.md
```

Observed result: `Summary: 0 error(s)`.

```bash
rg -n "opentelemetry|go\\.opentelemetry|@opentelemetry|OTel|Sentry|Axiom" \
  packages/ingestion-core packages/retrieval-core packages/rag-agent packages/contracts \
  -g '!**/__pycache__/**' \
  -g '!**/*.md'
```

Observed result: no matches; command exited 1 as expected for no hits.

## Next

Proceed to Phase 4: add Collector / sink pipeline config and runbook coverage for local debug,
Sentry and Axiom fan-out.
