---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Summary: Collector And Sink Pipeline

Phase 4 is complete.

## Implemented

- Added repo-owned Collector configs under `infra/otel/`:
  - `collector-local-debug.yaml`
  - `collector-staging-template.yaml`
  - `collector.env.example`
  - `README.md`
- Local debug profile receives OTLP traces, metrics and logs, applies forbidden-field deletion and
  explicit drop filtering, then exports only to the Collector `debug` exporter.
- Staging template receives OTLP traces, metrics and logs, applies the same redaction/drop chain,
  samples traces/logs, batches events, retries exporter failures and fans out:
  - traces to Sentry and Axiom
  - logs to Axiom
  - metrics to an Axiom metrics dataset
- Added health-check extension wiring for local and staging Collector configs.
- Kept all Sentry/Axiom endpoint/header/dataset values in environment substitution; tracked
  `collector.env.example` leaves those values blank.
- Added `tests/infra/runtime_otel_collector_config_suite.py` and wrapper test module to verify:
  - local debug pipeline shape
  - staging Sentry/Axiom/debug fan-out
  - forbidden attribute deletion
  - secret-free env example
  - Axiom metrics use `x-axiom-metrics-dataset`
- Added `docs/runbooks/runtime-otel-collector-pipeline.md` and linked it from runbook/staging docs.

## Verification

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

## Next

Proceed to Phase 5: run E2E smoke and closeout. This should prove online retrieval, offline
ingestion and exporter-unavailable failure behavior through the actual runtime path.
