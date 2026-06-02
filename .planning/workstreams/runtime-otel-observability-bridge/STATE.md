---
doc_type: state
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Runtime OTel Observability Bridge

## Current Status

- status: `completed`
- current slice: closeout complete
- owner: unassigned
- active implementation: runtime OTel bridge completed
- latest completed phase: Phase 5 `E2E Smoke And Closeout`
- next phase: none

## Captured Context

2026-05-01 planning context:

- User asked where OTel should be connected and whether the repo has fully introduced it.
- Current repo fact:
  - `apps/supervisor-api` already has Go OTel SDK, OTLP HTTP exporter, env gate, sampling,
    readiness and telemetry self-metrics.
  - `packages/retrieval-core` has `RetrievalObservationSink` and
    `retrieval.runtime_observation`, but no OTel SDK dependency.
  - `apps/app-api` has request lifecycle telemetry, Axiom sink and trace propagation helpers.
  - Retrieval production observation bridge, ingestion run telemetry and Collector/sink pipeline
    are not yet fully implemented.
- Architecture decision:
  - OTel integration belongs in runtime / adapter / deployment layers.
  - Core packages stay vendor-neutral.
  - Sentry/Axiom are sinks, not owners of repo telemetry semantics.

2026-05-01 Phase 0 completion context:

- Added `docs/reference/runtime-otel-telemetry-taxonomy.md` as the canonical runtime OTel taxonomy,
  attribute allowlist, forbidden-field list, runtime ownership matrix and focused verification
  expectation reference.
- Linked the taxonomy from `docs/architecture/system/operator-observability-architecture.md`,
  `docs/reference/README.md` and `docs/runbooks/supervisor-api-staging-operations.md`.
- Confirmed code facts:
  - `apps/supervisor-api` owns current Go OTel SDK/exporter/config/readiness self-health.
  - `apps/app-api` owns product request lifecycle telemetry and Sentry/Axiom trace propagation.
  - `apps/supervisor-agent-worker` currently only wires retrieval observations to JSONL.
  - `packages/retrieval-core` has the vendor-neutral sink and no OTel SDK dependency.
  - `apps/ingestion-worker` / `packages/ingestion-core` currently have source/provider
    observations, but no runtime OTel run telemetry bridge.
- External baseline reviewed:
  - OpenTelemetry semantic conventions, events, logs, Collector processors and GenAI semantic
    convention status.

2026-05-01 Phase 1 completion context:

- Hardened `apps/supervisor-api` as the online trace owner:
  - incoming HTTP requests now extract W3C `traceparent` / `baggage`
  - valid current `app-api` `sentry-trace` is converted to standard `traceparent` on ingress
  - bridge calls propagate only `traceparent`, `baggage`, `x-request-id` and `x-trace-id`
  - bridge HTTP client drops non-allowlisted trace headers such as `authorization`
- Tightened OTel signal names:
  - legacy `answer.*` / `answer_stream.*` telemetry names normalize to
    `runtime.request.accepted` / `runtime.request.finalized`
  - bridge attempts emit `agent.bridge.started`, `agent.bridge.completed` and
    `agent.bridge.failed`
- Added tests for:
  - incoming traceparent parent preservation
  - `sentry-trace` compatibility conversion
  - bridge trace header propagation
  - bridge HTTP trace header allowlist
  - emitter allowlisted attributes including `telemetry.allowed_attributes_version`
- Updated:
  - `apps/supervisor-api/README.md`
  - `docs/runbooks/supervisor-api-staging-operations.md`

2026-05-01 Phase 2 completion context:

- Added worker-owned retrieval observation bridge:
  - sanitizes `retrieval.runtime_observation` in
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/retrieval_observation_bridge.py`
  - preserves allowed correlation/scope/count/latency/hash fields
  - derives `no_hit`, `low_confidence`, `release_metadata_drift` and `reranker_degraded`
  - emits JSONL runtime event records through `SUPERVISOR_RETRIEVAL_RUNTIME_EVENT_JSONL_PATH`
- Composed existing raw observation JSONL with sanitized runtime event sink in worker RAG delegate
  wiring.
- Kept sink failure warning-only.
- Confirmed no OTel imports were added to `retrieval-core`, `rag-agent`, `contracts` or
  `ingestion-core`.

2026-05-01 Phase 3 completion context:

- Added worker-owned ingestion run telemetry bridge:
  - `apps/ingestion-worker/src/campus_ingestion_worker/ingestion_run_telemetry.py`
  - `INGESTION_RUN_TELEMETRY_JSONL_PATH` local/debug runtime event sink
- Added sanitized `ingestion.run.started`, `ingestion.run.completed` and
  `ingestion.run.failed` events to:
  - `prepare_registry_scope_chunks`
  - `release_registry_scope`
  - `release_index`
- Events carry run-level summary only: operation, stage, run id, scope, status, duration, counts,
  embedding cache/provider counts, release/audit status and failure kind.
- Raw canonical body, chunk body, OCR raw text, source credential, auth material and DB URL fields
  are excluded by allowlist.
- Telemetry export failure returns aggregate `telemetry.status=degraded` in worker stdout and does
  not fail the job.
- Updated index release runbook with ingestion telemetry smoke instructions.

2026-05-01 Phase 4 completion context:

- Added repo-owned Collector configs under `infra/otel/`:
  - `collector-local-debug.yaml`
  - `collector-staging-template.yaml`
  - `collector.env.example`
  - `README.md`
- Local debug Collector profile receives OTLP traces/metrics/logs, applies forbidden-field
  deletion and explicit `telemetry.drop` filtering, and exports only to `debug`.
- Staging Collector template applies the same redaction/drop chain, samples traces/logs, batches
  events and fans out:
  - traces to Sentry and Axiom
  - logs to Axiom
  - metrics to the Collector debug pipeline only
- Secret-bearing Sentry/Axiom endpoint/header/dataset values remain env substitutions; tracked env
  example values are blank.
- Added `docs/runbooks/runtime-otel-collector-pipeline.md` and linked it from staging/runbook docs.
- Added structural Collector config tests under `tests/infra/`.

2026-05-01 Phase 5 completion context:

- Added online runtime OTel smoke in
  `apps/supervisor-api/internal/httpapi/runtime_otel_e2e_test.go`.
- The online smoke drives `/api/v1/answer` through Go `supervisor-api`, fake bridge success path,
  real Go OTel OTLP HTTP exporter and an in-test local Collector endpoint.
- The in-test Collector verifies `/v1/traces` OTLP protobuf delivery, runtime span names, request
  id and `telemetry.allowed_attributes_version`.
- The same smoke verifies the OTLP payload excludes raw query, bearer token, auth/cookie markers,
  raw prompt, raw query and raw answer markers.
- Added negative online smoke proving an unavailable Collector endpoint does not fail the answer
  path.
- Reused retrieval runtime observation, ingestion run telemetry and Collector config focused
  suites as closeout evidence.
- Updated `docs/runbooks/runtime-otel-collector-pipeline.md`,
  `docs/architecture/current-architecture.md` and
  `docs/architecture/system/operator-observability-architecture.md` with completed runtime
  ownership and smoke posture.
- Added `ACCEPTANCE.md` to record repo-owned acceptance, external staging sink boundary, operator
  staging acceptance checklist and reopen rule.

## Blockers

- No planning blocker.
- Real Sentry/Axiom credentials are not required for this closeout; Phase 5 uses a local in-test
  Collector endpoint plus focused runtime event sinks.
- External staging sink validation remains an operator deployment smoke, not a blocker for the
  repo-owned runtime bridge closeout.
- Current worktree has unrelated dirty files under authenticated-notice and agents-sdk tests; do
  not touch them in this workstream.

## Verification Plan

Baseline planning/docs gate:

```bash
pnpm exec markdownlint-cli2 \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/runtime-otel-observability-bridge/README.md \
  .planning/workstreams/runtime-otel-observability-bridge/REQUIREMENTS.md \
  .planning/workstreams/runtime-otel-observability-bridge/ROADMAP.md \
  .planning/workstreams/runtime-otel-observability-bridge/STATE.md \
  .planning/workstreams/runtime-otel-observability-bridge/phases/**/*.md
```

Expected focused implementation gates by phase:

```bash
cd apps/supervisor-api && go test ./internal/config ./internal/telemetry ./internal/httpapi
```

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.evals.retrieval_monitoring_suite
```

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_index_release
```

```bash
pnpm web:test -- --runInBand
```

Concrete commands may be narrowed during phase planning to avoid unrelated dirty-worktree failures.

Phase 0 observed verification:

```bash
pnpm exec markdownlint-cli2 \
  docs/reference/runtime-otel-telemetry-taxonomy.md \
  docs/reference/README.md \
  docs/architecture/system/operator-observability-architecture.md \
  docs/runbooks/supervisor-api-staging-operations.md \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/runtime-otel-observability-bridge/README.md \
  .planning/workstreams/runtime-otel-observability-bridge/REQUIREMENTS.md \
  .planning/workstreams/runtime-otel-observability-bridge/ROADMAP.md \
  .planning/workstreams/runtime-otel-observability-bridge/STATE.md \
  .planning/workstreams/runtime-otel-observability-bridge/phases/**/*.md
```

Observed result: `Summary: 0 error(s)`.

```bash
git diff --check -- \
  docs/reference/runtime-otel-telemetry-taxonomy.md \
  docs/reference/README.md \
  docs/architecture/system/operator-observability-architecture.md \
  docs/runbooks/supervisor-api-staging-operations.md \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/runtime-otel-observability-bridge
```

Observed result: passed.

```bash
rg -n "opentelemetry|go\\.opentelemetry|@opentelemetry|OTel" \
  packages/retrieval-core packages/rag-agent packages/contracts packages/ingestion-core \
  -g '!**/__pycache__/**' \
  -g '!**/*.md'
```

Observed result: no matches; command exited 1 as expected for no hits.

Phase 1 observed verification:

```bash
cd apps/supervisor-api && \
  go test ./internal/config ./internal/telemetry ./internal/bridge ./internal/httpapi
```

Observed result: passed.

Phase 2 observed verification:

```bash
uv run --all-packages python -m unittest \
  tests.supervisor.retrieval_observation_bridge_suite \
  tests.api.supervisor_api_settings_and_health_suite -q
```

Observed result: `Ran 20 tests ... OK`.

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.evals.retrieval_monitoring_suite -q
```

Observed result: `Ran 17 tests ... OK`.

```bash
uv run --all-packages ruff check \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/retrieval_observation_bridge.py \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/settings.py \
  tests/supervisor/retrieval_observation_bridge_suite.py \
  tests/supervisor/test_retrieval_observation_bridge.py
```

Observed result: `All checks passed!`.

```bash
uv run --all-packages ruff format --check \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/retrieval_observation_bridge.py \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/settings.py \
  tests/supervisor/retrieval_observation_bridge_suite.py \
  tests/supervisor/test_retrieval_observation_bridge.py
```

Observed result: `5 files already formatted`.

Phase 3 observed verification:

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

```bash
cd apps/supervisor-api && go test ./internal/observability
```

Observed result: passed.

```bash
cd apps/supervisor-api && go test ./...
```

Observed result: passed.

Phase 4 observed verification:

```bash
uv run --all-packages python -m unittest tests.infra.runtime_otel_collector_config_suite -q
```

Observed result: `Ran 4 tests ... OK`.

```bash
uv run --all-packages yamllint -c .yamllint.yml \
  infra/otel/collector-local-debug.yaml \
  infra/otel/collector-staging-template.yaml
```

Observed result: passed.

```bash
uv run --all-packages ruff check \
  tests/infra/runtime_otel_collector_config_suite.py \
  tests/infra/test_runtime_otel_collector_config.py
```

Observed result: `All checks passed!`.

```bash
uv run --all-packages ruff format --check \
  tests/infra/runtime_otel_collector_config_suite.py \
  tests/infra/test_runtime_otel_collector_config.py
```

Observed result: `2 files already formatted`.

Phase 5 observed verification:

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

## Continuity Notes

- Keep `retrieval-core` and `contracts` free of OTel / Sentry / Axiom imports.
- Add runtime telemetry code only in `apps/*` runtime shells or explicit adapter modules.
- Keep raw text disabled by default. Any debug override must be explicit, bounded and documented.
- Treat telemetry as observation/backlog/eval intake only; do not let telemetry mutate release truth,
  runtime profile, serving alias or product read model.
- Keep local default off unless a phase explicitly adds a local debug Collector profile.

## Reopen Rule

After completion, reopen only if a new runtime path bypasses OTel trace/request correlation,
retrieval observation stops producing sanitized production events, ingestion release telemetry loses
run-level coverage, Collector redaction/fan-out config drifts, raw sensitive fields appear in
telemetry, exporter failure starts breaking product paths, or Sentry/Axiom integration becomes
vendor-coupled inside core packages.
