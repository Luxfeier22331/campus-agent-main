---
doc_type: acceptance_record
status: accepted
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Acceptance: Runtime OTel Observability Bridge

## Verdict

Accepted on 2026-05-01 for repo-owned runtime OTel bridge closeout.

This acceptance covers the codebase-owned runtime semantics, local/in-test OTLP delivery path,
sanitized event projection, Collector configuration structure, documentation and boundary guards.

It does not claim that production Sentry/Axiom credentials were exercised from this workstation.
External sink delivery remains an operator deployment smoke using
`docs/runbooks/runtime-otel-collector-pipeline.md`.

## Acceptance Matrix

| Area | Evidence | Verdict |
| --- | --- | --- |
| Online trace owner | `cd apps/supervisor-api && go test ./internal/httpapi -run 'TestRuntimeOtel' -count=1` | accepted |
| Online OTLP delivery | In-test Collector receives `/v1/traces` protobuf from `/api/v1/answer` smoke | accepted |
| Online redaction | OTLP payload excludes raw query, bearer token, authorization/cookie markers, raw prompt/query/answer markers | accepted |
| Sink-down fail-safe | `TestRuntimeOtelUnavailableCollectorDoesNotFailAnswerPath` keeps answer path successful | accepted |
| Supervisor API telemetry regression | `cd apps/supervisor-api && go test ./internal/config ./internal/telemetry ./internal/bridge ./internal/httpapi` | accepted |
| Retrieval runtime event bridge | `uv run --all-packages python -m unittest tests.supervisor.retrieval_observation_bridge_suite -q` | accepted |
| Ingestion run telemetry | `uv run --all-packages python -m unittest tests.ingestion.ingestion_worker_run_telemetry_suite -q` | accepted |
| Collector config structure | `uv run --all-packages python -m unittest tests.infra.runtime_otel_collector_config_suite -q` | accepted |
| Collector YAML lint | `uv run --all-packages yamllint -c .yamllint.yml infra/otel/collector-local-debug.yaml infra/otel/collector-staging-template.yaml` | accepted |
| Python style | focused `ruff check` and `ruff format --check` on runtime OTel test suites | accepted |
| Docs/planning consistency | focused `markdownlint-cli2` on OTel workstream, runbook and architecture docs | accepted |
| Core package vendor neutrality | `rg` dependency guard over `packages/ingestion-core`, `packages/retrieval-core`, `packages/rag-agent`, `packages/contracts` returns no matches | accepted |
| Real Collector binary validation | `otelcol-contrib validate ...` | not run here; binary absent |
| Real Sentry/Axiom sink delivery | deployment secret-backed staging smoke | operator acceptance, not repo closeout blocker |

## Operator Staging Acceptance

Run this only in an environment with `otelcol-contrib` and managed Sentry/Axiom secrets.

1. Populate the env values documented in `infra/otel/collector.env.example`.
2. Validate both Collector configs:

   ```bash
   otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml
   otelcol-contrib validate --config=infra/otel/collector-staging-template.yaml
   ```

3. Start the Collector with the staging template.
4. Enable `supervisor-api` OTLP export to the Collector:

   ```bash
   SUPERVISOR_API_OTEL_ENABLED=true
   SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector-host>:4318/v1/traces
   ```

5. Send one staging `/api/v1/answer` request with trace context.
6. Confirm Sentry receives trace evidence.
7. Confirm Axiom receives traces/logs through `x-axiom-dataset`.
8. Confirm Axiom receives metrics through `x-axiom-metrics-dataset`.
9. Confirm no raw prompt, raw query, raw answer, chunk body, canonical body, OCR raw text,
   authorization, cookie, JWT, database URL or provider secret appears in sink records.
10. Stop or block the Collector/exporter and confirm product request handling remains fail-safe.

## Reopen Rule

Reopen this workstream only if a new runtime path bypasses OTel trace/request correlation,
retrieval observation stops producing sanitized production events, ingestion release telemetry loses
run-level coverage, Collector redaction/fan-out config drifts, raw sensitive fields appear in
telemetry, exporter failure starts breaking product paths, or Sentry/Axiom integration becomes
vendor-coupled inside core packages.
