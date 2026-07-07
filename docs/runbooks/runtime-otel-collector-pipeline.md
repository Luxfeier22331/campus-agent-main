---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-05-01
updated: 2026-07-04
---
# Runtime OTel Collector Pipeline

This runbook defines how the repo-owned runtime telemetry pipeline is validated and operated.
Signal taxonomy, allowed attributes and forbidden fields remain defined in
`docs/reference/runtime-otel-telemetry-taxonomy.md`.

## Boundary

- Runtime apps emit sanitized OTLP or OTel-compatible runtime events.
- Cloudflare Worker surfaces emit OTLP HTTP to the protected Collector OTLP
  HTTP receiver; the receiver enforces bearer authentication before the
  Collector pipeline processes accepted signals.
- Collector config lives under `infra/otel/`.
- The Collector performs resource enrichment, forbidden-field deletion, explicit drop filtering,
  sampling, batching, retry and sink fan-out.
- Sentry, Axiom and Langfuse are sinks. They do not define repo telemetry semantics.
- Core packages must not import OTel, Sentry, Axiom or Collector-specific types.
- In this runbook, `Collector` means the OpenTelemetry Collector under
  `infra/otel`; it does not refer to business source collection adapters under
  `apps/source-collector`.

## Config Files

- `infra/otel/collector-local-debug.yaml`
  - receives OTLP traces, metrics and logs
  - applies the same redaction/drop chain as staging
  - exports only to the Collector `debug` exporter
- `infra/otel/collector-staging-template.yaml`
  - receives OTLP traces, metrics and logs
  - exports traces to Sentry, Axiom and Langfuse
  - exports logs to Axiom
  - exports metrics to the Axiom metrics dataset
- `infra/otel/collector.env.example`
  - documents required environment variables
  - keeps all endpoint/header/dataset values blank in the tracked file
  - documents non-secret protocol constants such as
    `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4`

Use `otelcol-contrib` for validation and local smoke because the pipeline uses Collector
processors that are not guaranteed in every minimal distribution.

## Local Debug Smoke

Start a local Collector with the debug profile:

```bash
otelcol-contrib --config=infra/otel/collector-local-debug.yaml
```

Enable `execution-control` OTLP export in the runtime config:

```json
{
  "otel": {
    "enabled": true,
    "endpoint": "http://127.0.0.1:4318/v1/traces"
  }
}
```

Expected local closeout artifacts:

- Collector process stays healthy on `:13133`
- debug exporter prints request/bridge trace records
- emitted records include `service.namespace=campus-agent`
- emitted records include `telemetry.allowed_attributes_version=runtime-otel-attrs-v1`
- emitted records do not include raw prompt, raw query, raw answer, chunk body, canonical body,
  OCR raw text, authorization, cookie, JWT, database URL or provider secret fields
- app-api `request.stage_timing` events produce
  `campus.app_api.stage_duration_ms` with bounded labels only
- execution-control metrics include runtime request/error/decision counters and
  activity duration, queue wait and schedule-to-start histograms

Worker JSONL sinks remain available as local debug handoff surfaces. Runtime now
also supports Worker-origin OTLP export through the protected Collector OTLP HTTP
receiver; JSONL is no longer the only bridge runtime telemetry path. Workers
must not post directly to vendor sinks.

## Staging Env

Canonical staging defaults to `collector-local-debug.yaml` and does not require
Sentry/Axiom/Langfuse sink credentials in the env file. Keep those values absent
unless the goal is to prove external fan-out. To enable fan-out, set:

```bash
EXECUTION_CONTROL_STAGING_OBSERVABILITY_MODE=fanout
EXECUTION_CONTROL_STAGING_OTEL_COLLECTOR_CONFIG_FILE=../otel/collector-staging-template.yaml
```

Then populate the staging template from deployment secrets, not from tracked
files:

```bash
DEPLOYMENT_ENVIRONMENT=staging
EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@<git-sha>
OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT=0.0.0.0:4317
OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT=0.0.0.0:4318
OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT=0.0.0.0:13133
OTEL_COLLECTOR_MEMORY_LIMIT_MIB=512
OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB=128
OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE=100
OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE=100
OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=<secret-managed endpoint>
OTEL_COLLECTOR_SENTRY_AUTH_VALUE=<secret-managed x-sentry-auth value>
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co
OTEL_COLLECTOR_AXIOM_AUTH_HEADER=<secret-managed header>
OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime
OTEL_COLLECTOR_AXIOM_METRICS_DATASET=campus-agent-runtime-metrics
APP_API_OTEL_INGEST_SHARED_SECRET=<secret-managed Worker ingest secret>
EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer <same secret>"
LANGFUSE_BASE_URL=https://langfuse.internal
LANGFUSE_PUBLIC_KEY=<secret-managed project public key>
LANGFUSE_SECRET_KEY=<secret-managed project secret key>
LANGFUSE_ENVIRONMENT=staging
OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=${LANGFUSE_BASE_URL}/api/public/otel
OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER=<derived Basic public:secret header>
OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4
```

Canonical execution-control staging derives `EXECUTION_CONTROL_RUNTIME_RELEASE`
as `execution-control@<deploy git sha>` in the lifecycle loader. Set it
explicitly only for non-canonical deployment shells. When the execution-control
runtime config enables OTel, runtime startup fails closed if this release
identity is missing.

For Sentry, use the combined OTLP endpoint from **Client Keys (DSN) > OpenTelemetry
(OTLP)** and configure `OTEL_COLLECTOR_SENTRY_AUTH_VALUE` as
`sentry sentry_key=<public key>`. The Collector template sends this value using the
official `x-sentry-auth` header.

For Langfuse, the canonical inputs are `LANGFUSE_BASE_URL`,
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_ENVIRONMENT`.
Collector-specific `OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT` and
`OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER` are derived deployment values:
`${LANGFUSE_BASE_URL}/api/public/otel` and `Basic base64(public:secret)`.
Do not hand-maintain duplicate endpoint/header values in local closeout env.
If a deploy renderer materializes the Collector env file, it must fail when a
preexisting derived value drifts from those canonical inputs.

Secret-bearing `collector.env.example` values stay blank. The Collector process
still consumes `OTEL_COLLECTOR_LANGFUSE_*` because those are exporter-local
settings; human-maintained staging config should own only the canonical
`LANGFUSE_*` values plus the non-secret protocol constant.
`OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4` is a non-secret protocol constant.
Real endpoint, header and dataset values belong in the deployment secret manager
or local ignored environment file after derivation.

The runtime compose file treats the Langfuse exporter as part of the staging
fan-out contract. `OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT`,
`OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER` and
`OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION` are required when using
`infra/local/docker-compose.execution-control-runtime.yml`.

## Validation

Structural repo test:

```bash
pnpm ci:langfuse
pnpm contracts:check
```

`pnpm contracts:check` validates both latency budgets and
`configs/runtime/observability-alerts.v1.json`. The alert artifact is the
repo-owned symptom policy source for stage latency, request error rate,
projection outbox, telemetry export failure and missing trace rate alerts. It
also materializes one Axiom monitor spec per enabled alert rule through
`scripts/materialize_observability_alerts.py`. The repo still does not mirror
external dashboard content into app-api.

Fail-closed Langfuse env check:

```bash
OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.internal/api/public/otel \
OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER="Basic <base64-public-secret-pair>" \
OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4 \
pnpm --dir packages/eval-langfuse langfuse check-collector-config --json
```

Langfuse Ragas score smoke:

```bash
LANGFUSE_BASE_URL=https://langfuse.internal \
LANGFUSE_PUBLIC_KEY=<project-public-key> \
LANGFUSE_SECRET_KEY=<project-secret-key> \
LANGFUSE_ENVIRONMENT=staging \
pnpm --dir packages/eval-langfuse langfuse ragas-score-traces \
  --trace-name online-answer \
  --limit 5 \
  --validate-only \
  --json
```

Use `ragas-score-dataset` for Langfuse dataset-backed scoring. Remove
`--validate-only` only when the run should write `ragas.*` scores to Langfuse.

Langfuse real trace closeout smoke:

```bash
LANGFUSE_BASE_URL=https://langfuse.internal \
LANGFUSE_PUBLIC_KEY=<project-public-key> \
LANGFUSE_SECRET_KEY=<project-secret-key> \
pnpm --dir packages/eval-langfuse langfuse verify-trace \
  --product-trace-id <app-api-trace-id-from-chat-request> \
  --session-id <conversation-id> \
  --user-id <stable-non-pii-user-id> \
  --release <runtime-release-id> \
  --request-id <app-api-request-id> \
  --run-id <execution-run-id> \
  --workflow-id <temporal-workflow-id> \
  --tag surface:execution-control \
  --tag target:knowledge \
  --tag env:staging \
  --json
```

`--product-trace-id` derives the Langfuse trace id using the same deterministic
mapping as app-api trace propagation and eval score publishing. Use `--trace-id`
instead only when the Langfuse trace id is already known. This command queries
Langfuse `GET /api/public/traces/{traceId}` with `fields=core,observations` and
fails closed when the trace is missing, the session / user / release / required
tags drift, the trace lacks populated identity attributes (`request_id`,
`run_id`, `workflow_id`, `trace_id`), the provided request / run / workflow ids
do not match the trace closeout artifact, the trace has no observations, or no
observation exposes the runtime observation attribute contract (`step_id`,
`step_kind`, `activity_type`, `task_queue`, `activity_attempt`, selected
tool/tool, status, timing, projection ref and fail-close reason). Successful
JSON output includes `forbidden_check_passed=true`, repo-owned observation
counts and checked identity fields. Omit
the request / run / workflow id flags only for local diagnostics. Release
closeout must include them from the staging durable reconnect artifact. This
command produces release closeout artifacts only; Langfuse remains a sink and
does not become product truth.

Langfuse trace closeout artifact is produced by running `verify-trace` with the
identity values from `chat-durable-reconnect.json`. The old bundled
`closeout-staging` / `build-release-artifacts` / `check-release-artifacts` path
has been retired with the artifact score-report publisher.

`chat-durable-reconnect.json` is produced by
`pnpm --dir apps/app-api chat:durable:e2e:staging`. Its `langfuseCloseout` block
is the product-side identity source for closeout: `productTraceId`, `requestId`,
`runId`, `workflowId`, `sessionId` and `userId`. Do not derive `workflowId` from
`runId`; it must come from the sanitized run step attempt projection.

Manual trace closeout path:

```bash
pnpm --dir packages/eval-langfuse langfuse verify-trace \
  --product-trace-id "$(jq -er '.langfuseCloseout.productTraceId' "$E2E_QA_EVIDENCE_DIR/chat-durable-reconnect.json")" \
  --request-id "$(jq -er '.langfuseCloseout.requestId' "$E2E_QA_EVIDENCE_DIR/chat-durable-reconnect.json")" \
  --run-id "$(jq -er '.langfuseCloseout.runId' "$E2E_QA_EVIDENCE_DIR/chat-durable-reconnect.json")" \
  --workflow-id "$(jq -er '.langfuseCloseout.workflowId' "$E2E_QA_EVIDENCE_DIR/chat-durable-reconnect.json")" \
  --session-id "$(jq -er '.langfuseCloseout.sessionId' "$E2E_QA_EVIDENCE_DIR/chat-durable-reconnect.json")" \
  --user-id "$(jq -er '.langfuseCloseout.userId' "$E2E_QA_EVIDENCE_DIR/chat-durable-reconnect.json")" \
  --release <runtime-release-id> \
  --tag surface:execution-control \
  --tag target:knowledge \
  --tag env:staging \
  --json | tee "$E2E_QA_EVIDENCE_DIR/verify-trace.json"
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
  packages/ingest-core packages/contracts \
  -g '!**/__pycache__/**' \
  -g '!**/*.md'
```

Expected result: no matches; `rg` exits with `1`.

## Closeout Smoke

The workstream-level acceptance record is
`git history runtime otel observability acceptance artifact`.

Runtime OTel and Temporal tracing smoke through `execution-control`:

```bash
cd apps/execution-control && \
  go test -count=1 \
    -run 'TestEmitterPreservesIncomingTraceParent|TestEmitterAddsLangfuseTraceSessionAttributes|TestTracingInterceptorsProduceTemporalSDKInterceptorsWhenEnabled|TestNewWorkerTelemetryRuntimeInstallsProviderBeforeTracing|TestProjectTemporalStepEmitsLangfuseObservationTelemetry|TestRuntimeTelemetryEventIncludesLangfuseSessionAndUser' \
    ./internal/telemetry ./internal/temporalruntime ./cmd/internal/workermain ./internal/httpapi
```

Expected closeout artifacts:

- `TestEmitterPreservesIncomingTraceParent` proves execution-control spans keep
  the W3C trace id propagated from app-api.
- `TestEmitterAddsLangfuseTraceSessionAttributes` proves the sanitized
  Langfuse trace/session/user/release/tag attributes are emitted.
- `TestTracingInterceptorsProduceTemporalSDKInterceptorsWhenEnabled` proves the
  runtime uses the Temporal Go SDK OpenTelemetry interceptor when configured.
- `TestNewWorkerTelemetryRuntimeInstallsProviderBeforeTracing` proves worker
  bootstrap installs the repo OTel provider before Temporal tracing starts.
- `TestProjectTemporalStepEmitsLangfuseObservationTelemetry` proves an
  execution-control Temporal step observation reaches an in-test `/v1/traces`
  OTLP collector as protobuf with Langfuse observation attributes.
- `pnpm --dir packages/eval-langfuse langfuse verify-trace ... --json`
  passes for the real deployed chat request trace after the Collector fans out
  to Langfuse.
- `verify-trace.json` is saved with product trace, request, run, workflow,
  session and user identity checked against the real deployed Langfuse trace.

Collector config structural smoke:

```bash
pnpm ci:langfuse
pnpm contracts:check
uv run --all-packages python -m unittest tests.infra.test_k8s_execution_runtime_manifests -q
```

`pnpm ci:langfuse` covers the TS Langfuse package and trace id vector checks.
These checks prove the eval platform management plane can create sanitized
artifacts; they do not replace the real staging trace and score publish closeout.
`pnpm contracts:check` covers alert materialization and latency-budget coverage
of every canonical `stage_timing.v1` field.

## Drop Diagnosis

If the Collector receives telemetry but no sink records appear:

1. Check Collector logs for exporter retry or queue warnings.
2. Check `telemetry.drop=true`; the filter processor intentionally drops those records.
3. Check sampling percentages.
4. Confirm Sentry and Axiom endpoint/header values were injected by the runtime secret manager.
5. Confirm Langfuse endpoint, Basic auth header and ingestion version passed
   `pnpm --dir packages/eval-langfuse langfuse check-collector-config --json`.
6. Confirm Sentry uses `x-sentry-auth`, not `Authorization`.
7. Confirm `OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` is the Axiom edge deployment base domain only,
   for example `https://us-east-1.aws.edge.axiom.co`. Do not append `/v1/traces`, `/v1/logs`,
   or `/v1/metrics` in the Collector exporter config because `otlphttp` appends the signal path
   automatically.
8. Confirm Worker-origin telemetry is posted to the protected Collector OTLP
   HTTP receiver with bearer auth, not to vendor sinks.
9. Confirm Axiom traces/logs use `x-axiom-dataset=campus-agent-runtime`.
10. Confirm Axiom metrics use
   `x-axiom-dataset=campus-agent-runtime-metrics`.

When OTel is explicitly enabled, exporter failure is part of the configured
runtime contract and answer paths fail closed with `telemetry_delivery_failed`.
When OTel is disabled in a local profile, missing sink closeout artifacts are
expected and must not be treated as release closeout failure.
