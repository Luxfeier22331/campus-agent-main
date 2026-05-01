---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Summary: E2E Smoke And Closeout

Phase 5 is complete.

## Implemented

- Added `apps/supervisor-api/internal/httpapi/runtime_otel_e2e_test.go`.
- Added an online runtime smoke that drives `/api/v1/answer` through:
  - Go `supervisor-api` handler
  - fake bridge success path
  - real Go OTel OTLP HTTP exporter
  - in-test local Collector endpoint
- The online smoke verifies Collector evidence:
  - POST reaches `/v1/traces`
  - payload is OTLP protobuf
  - payload includes runtime span names, request id and
    `telemetry.allowed_attributes_version`
  - payload does not include raw user query, bearer token, authorization/cookie markers, raw prompt,
    raw query or raw answer markers
- Added a negative online smoke proving an unavailable Collector endpoint does not fail the answer
  path.
- Reused Phase 2/3 focused smoke as closeout coverage for:
  - retrieval runtime observation JSONL event delivery
  - ingestion run started/completed/failed event delivery
  - ingestion telemetry sink failure as degraded, not job failure
- Updated `docs/runbooks/runtime-otel-collector-pipeline.md` with closeout smoke commands and
  expected evidence.
- Updated current architecture and operator observability architecture with the completed runtime
  OTel ownership state.
- Closed the workstream in `README.md`, `ROADMAP.md`, `STATE.md` and `.planning/WORKSTREAMS.md`.

## Verification

```bash
cd apps/supervisor-api && \
  go test ./internal/httpapi -run 'TestRuntimeOtel' -count=1
```

Observed result: passed.

```bash
cd apps/supervisor-api && go test ./internal/config ./internal/telemetry ./internal/bridge ./internal/httpapi
```

Observed result: passed.

```bash
uv run --all-packages python -m unittest \
  tests.supervisor.retrieval_observation_bridge_suite \
  tests.ingestion.ingestion_worker_run_telemetry_suite \
  tests.infra.runtime_otel_collector_config_suite -q
```

Observed result: passed.

```bash
uv run --all-packages ruff check \
  tests/supervisor/retrieval_observation_bridge_suite.py \
  tests/supervisor/test_retrieval_observation_bridge.py \
  tests/ingestion/ingestion_worker_run_telemetry_suite.py \
  tests/ingestion/test_ingestion_worker_run_telemetry.py \
  tests/infra/runtime_otel_collector_config_suite.py \
  tests/infra/test_runtime_otel_collector_config.py
```

Observed result: passed.

```bash
uv run --all-packages ruff format --check \
  tests/supervisor/retrieval_observation_bridge_suite.py \
  tests/supervisor/test_retrieval_observation_bridge.py \
  tests/ingestion/ingestion_worker_run_telemetry_suite.py \
  tests/ingestion/test_ingestion_worker_run_telemetry.py \
  tests/infra/runtime_otel_collector_config_suite.py \
  tests/infra/test_runtime_otel_collector_config.py
```

Observed result: passed.

```bash
uv run --all-packages yamllint -c .yamllint.yml \
  infra/otel/collector-local-debug.yaml \
  infra/otel/collector-staging-template.yaml
```

Observed result: passed.

```bash
pnpm exec markdownlint-cli2 \
  '.planning/workstreams/runtime-otel-observability-bridge/**/*.md' \
  infra/otel/README.md \
  docs/runbooks/runtime-otel-collector-pipeline.md \
  docs/runbooks/README.md \
  docs/runbooks/supervisor-api-staging-operations.md \
  docs/architecture/current-architecture.md \
  docs/architecture/system/operator-observability-architecture.md \
  .planning/WORKSTREAMS.md
```

Observed result: `Summary: 0 error(s)`.

```bash
rg -n "opentelemetry|go\\.opentelemetry|@opentelemetry|OTel|Sentry|Axiom" \
  packages/ingestion-core packages/retrieval-core packages/rag-agent packages/contracts \
  -g '!**/__pycache__/**' \
  -g '!**/*.md'
```

Observed result: no matches; command exited 1 as expected for no hits.

## Closeout

This workstream is completed. Reopen only if a new runtime path bypasses OTel trace/request
correlation, retrieval observation stops producing sanitized production events, ingestion release
telemetry loses run-level coverage, Collector redaction/fan-out config drifts, raw sensitive fields
appear in telemetry, exporter failure starts breaking product paths, or Sentry/Axiom integration
becomes vendor-coupled inside core packages.
