# Runtime OTel Collector Config

This directory contains repo-owned OpenTelemetry Collector configuration for the
`runtime-otel-observability-bridge` workstream.

## Files

- `collector-local-debug.yaml`: local debug Collector config. It receives
  OTLP traces, metrics and logs, applies the repo forbidden-field deletion
  policy and exports to the Collector `debug` exporter.
- `collector-staging-template.yaml`: staging/prod template. It receives OTLP,
  applies the same redaction chain, samples traces/logs, exports traces to
  Sentry and Axiom, exports logs to Axiom, and exports metrics to an Axiom
  metrics dataset.
- `collector.env.example`: required environment variables. Secret-bearing
  values are intentionally blank and must be supplied by the deployment secret
  manager.

## Signal Routing

- Runtime apps send OTLP to this Collector, not directly to vendor sinks.
- The Collector deletes the repo forbidden fields before any exporter runs.
- Sentry receives traces only. Axiom receives traces/logs through
  `x-axiom-dataset` and metrics through `x-axiom-metrics-dataset`, matching
  Axiom's separate dataset requirement for metrics.
- `OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` must be the base domain, for example
  `https://us-east-1.aws.edge.axiom.co`. Do not include `/v1/traces`,
  `/v1/logs`, or `/v1/metrics` because the Collector `otlphttp` exporter
  appends the signal path.
- `OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` must match `AXIOM_ENDPOINT` so Worker-local
  and Collector-based exports land in the same Axiom edge deployment.
- Local debug uses only the `debug` exporter and does not require Sentry/Axiom credentials.

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
uv run --all-packages python -m unittest \
  tests.infra.runtime_otel_collector_config_suite -q
```
