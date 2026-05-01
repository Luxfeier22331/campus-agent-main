---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Scope And Schema Freeze

## Result

Phase 0 is complete. The workstream now has a frozen runtime OTel boundary, event taxonomy,
attribute allowlist, forbidden-field policy, runtime ownership matrix and focused verification
expectations before implementation starts.

## Code Facts Audited

- `apps/supervisor-api/internal/telemetry/emitter.go`
  - already imports Go OTel SDK/exporter packages
  - exports spans through OTLP HTTP when `SUPERVISOR_API_OTEL_ENABLED=true`
  - keeps local default off and records exported/dropped/failed counters
  - sanitizes telemetry last error before health/status exposure
- `apps/supervisor-api/internal/config/config.go`
  - owns `SUPERVISOR_API_OTEL_ENABLED`,
    `SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT`,
    `SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS`,
    `SUPERVISOR_API_OTEL_SERVICE_NAME`,
    `SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS`,
    `SUPERVISOR_API_OTEL_SAMPLE_RATIO` and
    `SUPERVISOR_API_OTEL_ALLOWED_ATTRIBUTES_VERSION`
- `apps/app-api/src/modules/telemetry`
  - owns product request lifecycle telemetry
  - uses Sentry for exception/request scope and Axiom for structured app runtime events
  - propagates Sentry trace/baggage headers to supervisor transport
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py`
  - currently wires retrieval observations only to optional JSONL via
    `build_jsonl_retrieval_observation_sink`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
  - owns `RetrievalObservationSink`
  - emits `retrieval.runtime_observation` through `build_retrieval_observation_event_sink`
  - defaults to `query_sha256`; raw query is only included through explicit
    `include_observation_query_text`
  - catches sink failure and keeps retrieval answer path alive
- `apps/ingestion-worker` / `packages/ingestion-core`
  - have source/provider observations and ingestion artifacts
  - do not yet have a runtime OTel run telemetry bridge for canonical/chunk/embedding/index runs

## Documents Updated

- Added `docs/reference/runtime-otel-telemetry-taxonomy.md`
  - runtime ownership matrix
  - signal taxonomy
  - allowed attribute groups
  - forbidden fields
  - derived metrics policy
  - focused verification expectations
- Updated `docs/reference/README.md`
  - added the new taxonomy reference
- Updated `docs/architecture/system/operator-observability-architecture.md`
  - linked the taxonomy as the fixed OTel/Collector/adapter seam
- Updated `docs/runbooks/supervisor-api-staging-operations.md`
  - linked staging OTel behavior to the taxonomy and forbidden-field policy
- Updated workstream `README.md`, `ROADMAP.md` and `STATE.md`
  - Phase 0 completed
  - Phase 1 is now ready

## Frozen Decisions

- OTel SDK is allowed in runtime shells and adapters only:
  - `apps/supervisor-api`
  - `apps/supervisor-agent-worker`
  - `apps/ingestion-worker`
  - limited `apps/app-api` request lifecycle / propagation path
  - Collector / deployment adapter
- OTel SDK is not allowed in:
  - `packages/retrieval-core`
  - `packages/rag-agent`
  - `packages/contracts`
  - default `packages/ingestion-core` business/data-plane modules
- Sentry and Axiom are sinks, not owners of repo telemetry semantics.
- Raw prompt, raw query, raw answer, raw snippets, chunk/canonical body, OCR text, JWT, cookies,
  auth material and secrets are forbidden by default.
- Retrieval telemetry must use `query_sha256` by default.
- Metrics must be derived from low-cardinality fields; raw document ids, source urls and query hashes
  must not become metric labels.

## External Baseline

Reviewed and linked:

- OpenTelemetry semantic conventions:
  <https://opentelemetry.io/docs/concepts/semantic-conventions/>
- OpenTelemetry event semantic convention:
  <https://opentelemetry.io/docs/specs/semconv/general/events/>
- OpenTelemetry logs model:
  <https://opentelemetry.io/docs/specs/otel/logs/>
- OpenTelemetry Collector processors:
  <https://opentelemetry.io/docs/collector/components/processor/>
- OpenTelemetry GenAI spans development status:
  <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/>

## Next Phase

Phase 1: `Supervisor API Trace Owner Hardening`

Implementation should start from `apps/supervisor-api` because it already has the OTel SDK/exporter
and is the online trace owner. The expected output is hardened trace/span/event naming,
trace propagation evidence, allowlist/redaction tests and exporter failure fail-safe tests.
