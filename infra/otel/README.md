# Runtime OTel Collector Config

This directory contains repo-owned OpenTelemetry Collector configuration for the
`runtime-otel-observability-bridge` workstream.

## Files

- `collector-local-debug.yaml`: local debug Collector config. It receives
  OTLP traces, metrics and logs, applies the repo forbidden-field deletion
  policy and exports to the Collector `debug` exporter.
- `collector-staging-template.yaml`: staging/prod template. It receives OTLP,
  applies the same redaction chain, samples traces/logs, exports traces to
  Sentry, Axiom and Langfuse, exports logs to Axiom, and keeps metrics on the
  local debug pipeline.
- `collector.env.example`: required environment variables. Secret-bearing
  values are intentionally blank and must be supplied by the deployment secret
  manager.

## Signal Routing

- Runtime apps send OTLP to this Collector, not directly to vendor sinks.
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
- `OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` must match `AXIOM_ENDPOINT` so
  Worker-local and Collector-based exports land in the same Axiom edge
  deployment.
- Local debug uses only the `debug` exporter and does not require Sentry/Axiom
  credentials.
- Langfuse OTLP endpoint should be the `/api/public/otel` endpoint. Use
  `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4` unless the Langfuse deployment
  contract changes.
- The staging runtime compose requires Langfuse endpoint, Basic auth header and
  ingestion version to be populated. Missing values fail startup instead of
  allowing a broken exporter.

## Validation

Use `otelcol-contrib` for these configs because the repo pipeline relies on
processors that may not be present in every minimal Collector distribution:

```bash
otelcol-contrib validate --config=infra/otel/collector-staging-template.yaml
otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml
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
