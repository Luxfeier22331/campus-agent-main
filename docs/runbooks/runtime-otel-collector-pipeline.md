---
doc_type: runbook
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Runtime OTel Collector Pipeline

This runbook defines how the repo-owned runtime telemetry pipeline is validated and operated.
Signal taxonomy, allowed attributes and forbidden fields remain defined in
`docs/reference/runtime-otel-telemetry-taxonomy.md`.

## Boundary

- Runtime apps emit sanitized OTLP or OTel-compatible runtime events.
- Collector config lives under `infra/otel/`.
- The Collector performs resource enrichment, forbidden-field deletion, explicit drop filtering,
  sampling, batching, retry and sink fan-out.
- Sentry and Axiom are sinks. They do not define repo telemetry semantics.
- Core packages must not import OTel, Sentry, Axiom or Collector-specific types.

## Config Files

- `infra/otel/collector-local-debug.yaml`
  - receives OTLP traces, metrics and logs
  - applies the same redaction/drop chain as staging
  - exports only to the Collector `debug` exporter
- `infra/otel/collector-staging-template.yaml`
  - receives OTLP traces, metrics and logs
  - exports traces to Sentry and Axiom
  - exports logs to Axiom
  - exports metrics to Axiom through `x-axiom-metrics-dataset`
- `infra/otel/collector.env.example`
  - documents required environment variables
  - keeps all endpoint/header/dataset values blank in the tracked file

Use `otelcol-contrib` for validation and local smoke because the pipeline uses Collector
processors that are not guaranteed in every minimal distribution.

## Local Debug Smoke

Start a local Collector with the debug profile:

```bash
otelcol-contrib --config=infra/otel/collector-local-debug.yaml
```

Enable `supervisor-api` OTLP export to the local Collector:

```bash
SUPERVISOR_API_OTEL_ENABLED=true
SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces
```

Expected local evidence:

- Collector process stays healthy on `:13133`
- debug exporter prints request/bridge trace records
- emitted records include `service.namespace=campus-agent`
- emitted records include `telemetry.allowed_attributes_version=runtime-otel-attrs-v1`
- emitted records do not include raw prompt, raw query, raw answer, chunk body, canonical body,
  OCR raw text, authorization, cookie, JWT, database URL or provider secret fields

Phase 2/3 worker JSONL sinks remain local debug handoff surfaces until a JSONL-to-OTLP adapter is
explicitly added. They are not a replacement for the Collector fan-out path.

## Staging Env

Populate the staging template from deployment secrets, not from tracked files:

```bash
DEPLOYMENT_ENVIRONMENT=staging
OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT=0.0.0.0:4317
OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT=0.0.0.0:4318
OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT=0.0.0.0:13133
OTEL_COLLECTOR_MEMORY_LIMIT_MIB=512
OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB=128
OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE=100
OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE=100
OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=<secret-managed endpoint>
OTEL_COLLECTOR_SENTRY_AUTH_HEADER=<secret-managed header>
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=<secret-managed endpoint>
OTEL_COLLECTOR_AXIOM_AUTH_HEADER=<secret-managed header>
OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=<secret-managed dataset>
OTEL_COLLECTOR_AXIOM_METRICS_DATASET=<secret-managed metrics dataset>
```

Keep `collector.env.example` blank. Real values belong in the deployment secret manager or local
ignored environment file.

## Validation

Structural repo test:

```bash
uv run --all-packages python -m unittest tests.infra.runtime_otel_collector_config_suite -q
```

Collector binary validation:

```bash
otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml
otelcol-contrib validate --config=infra/otel/collector-staging-template.yaml
```

Focused lint:

```bash
yamllint -c .yamllint.yml infra/otel/collector-local-debug.yaml \
  infra/otel/collector-staging-template.yaml
```

Boundary guard:

```bash
rg -n "opentelemetry|go\\.opentelemetry|@opentelemetry|OTel|Sentry|Axiom" \
  packages/ingestion-core packages/retrieval-core packages/rag-agent packages/contracts \
  -g '!**/__pycache__/**' \
  -g '!**/*.md'
```

Expected result: no matches; `rg` exits with `1`.

## Closeout Smoke

The workstream-level acceptance record is
`.planning/workstreams/runtime-otel-observability-bridge/ACCEPTANCE.md`.

Online runtime smoke through `supervisor-api`:

```bash
cd apps/supervisor-api && \
  go test ./internal/httpapi -run 'TestRuntimeOtel' -count=1
```

Expected evidence:

- `TestRuntimeOtelOnlineSmokeExportsSanitizedTraceToCollector` drives
  `/api/v1/answer` through the Go runtime, bridge fake and OTLP HTTP exporter.
- The in-test Collector receives `/v1/traces` with protobuf payload.
- The payload includes runtime span names, request id and allowed telemetry version.
- The payload does not include raw query, bearer token, auth header name, raw prompt, raw answer or
  forbidden field names.
- `TestRuntimeOtelUnavailableCollectorDoesNotFailAnswerPath` keeps the answer path successful even
  when the configured Collector endpoint is unavailable.

Retrieval runtime event smoke:

```bash
uv run --all-packages python -m unittest \
  tests.supervisor.retrieval_observation_bridge_suite -q
```

Ingestion runtime event smoke:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.ingestion_worker_run_telemetry_suite -q
```

Collector config structural smoke:

```bash
uv run --all-packages python -m unittest \
  tests.infra.runtime_otel_collector_config_suite -q
```

## Drop Diagnosis

If the Collector receives telemetry but no sink records appear:

1. Check Collector logs for exporter retry or queue warnings.
2. Check `telemetry.drop=true`; the filter processor intentionally drops those records.
3. Check sampling percentages.
4. Confirm Sentry and Axiom endpoint/header values were injected by the runtime secret manager.
5. Confirm Axiom traces/logs use `x-axiom-dataset` and metrics use
   `x-axiom-metrics-dataset`.

Exporter failure must not break product request paths. It should appear as telemetry degraded
health or sink-side missing evidence, not as answer-path failure.
