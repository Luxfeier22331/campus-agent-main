# Runtime OTel Collector Config

This directory contains repo-owned OpenTelemetry Collector configuration for the
`runtime-otel-observability-bridge` workstream.

## Files

- `collector-local-debug.yaml`: local debug Collector config. It receives
  OTLP traces, metrics and logs, applies the repo forbidden-field deletion
  policy and exports to the Collector `debug` exporter.
- `collector-local-prodlike.yaml`: default local execution-control Collector
  config. It receives the same local OTLP signals, applies the forbidden-field
  deletion policy and fans out traces to the local self-hosted Langfuse OTLP
  endpoint plus the Collector `debug` exporter. Metrics and logs stay on the
  debug exporter.
- `collector-staging-template.yaml`: staging/prod template. It receives OTLP,
  applies the same redaction chain, samples traces/logs, exports traces to
  Sentry, Axiom and Langfuse, exports logs to Axiom, and keeps metrics on the
  local debug pipeline.
- `collector.env.example`: required environment variables. Secret-bearing
  values are intentionally blank and must be supplied by the deployment secret
  manager. It also documents the controlled OTLP ingest gateway inputs used by
  Worker-origin telemetry.

## Signal Routing

- Runtime apps send OTLP to this Collector, not directly to vendor sinks.
- Cloudflare Worker surfaces send OTLP HTTP to the controlled
  `otel-ingest-gateway`; only that gateway forwards accepted `/v1/traces` and
  `/v1/logs` requests to the Collector HTTP receiver.
- The Collector deletes the repo forbidden fields before any exporter runs.
- Sentry receives traces only. Langfuse receives traces only. Axiom receives
  traces/logs through `x-axiom-dataset` in the project-level
  `campus-agent-runtime` dataset.
  Metrics stay in the Collector debug pipeline and do not consume a separate
  Axiom dataset quota.
- `OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` must be the base domain, for example
  `https://us-east-1.aws.edge.axiom.co`. Do not include `/v1/traces`,
  `/v1/logs`, or `/v1/metrics` because the Collector `otlphttp` exporter
  appends the signal path.
- Worker surfaces must not configure Axiom REST ingest. Axiom endpoint, auth
  header and dataset are Collector exporter settings only.
- Default local execution-control runtime uses `collector-local-prodlike.yaml`
  and the self-hosted Langfuse compose stack. Set
  `EXECUTION_CONTROL_RUNTIME_FLAVOR=minimal` when a local smoke only needs the
  `debug` exporter and should not start Langfuse.
- Local minimal/debug uses only the `debug` exporter and does not require
  Sentry/Axiom/Langfuse credentials.
- Langfuse OTLP endpoint should be the `/api/public/otel` endpoint. Use
  `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4` unless the Langfuse deployment
  contract changes.
- Canonical staging defaults to `collector-local-debug.yaml` so staging env can
  stay free of external sink credentials. Set
  `EXECUTION_CONTROL_STAGING_OBSERVABILITY_MODE=fanout` and
  `EXECUTION_CONTROL_STAGING_OTEL_COLLECTOR_CONFIG_FILE=../otel/collector-staging-template.yaml`
  only when Sentry/Axiom/Langfuse sink credentials are intentionally deployed.
- The staging runtime compose exposes only `otel-ingest-gateway` for Worker
  OTLP. It does not expose raw Collector OTLP receivers.

## Validation

Use `otelcol-contrib` for these configs because the repo pipeline relies on
processors that may not be present in every minimal Collector distribution:

```bash
otelcol-contrib validate --config=infra/otel/collector-staging-template.yaml
otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml
otelcol-contrib validate --config=infra/otel/collector-local-prodlike.yaml
```

The staging template uses environment substitution. Populate
`collector.env.example` values before validating it with a real Collector
binary.

Without a local Collector binary, run the repo structural guard:

```bash
pnpm langfuse:check
```

To check a populated staging shell before starting compose:

```bash
uv run --all-packages python scripts/check_runtime_otel_collector_config.py
```

To prove the staging template Langfuse fan-out path with the real Collector
container and local fake Sentry / Axiom / Langfuse OTLP endpoints:

```bash
pnpm langfuse:fanout:proof
```

The proof requires the fake Langfuse sink to receive `/api/public/otel/v1/traces`
with Basic auth, ingestion version `4` and sanitized Langfuse / runtime
attributes in the decoded OTLP protobuf body.
