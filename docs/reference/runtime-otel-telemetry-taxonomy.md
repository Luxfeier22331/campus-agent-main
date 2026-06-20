---
doc_type: reference
truth_scope: ops
owner_boundary: apps/execution-control
status: active
created: 2026-05-01
updated: 2026-05-01
---
<!-- markdownlint-disable MD013 -->

# Runtime OTel Telemetry Taxonomy

This document freezes the repo-owned telemetry taxonomy for the runtime OTel bridge workstream.
It defines where OTel SDKs are allowed, which runtime owns each signal, which attributes are
allowed, and which fields must never be sent to telemetry sinks.

## External Baseline

This taxonomy follows the OpenTelemetry direction that:

- semantic conventions provide shared names for traces, metrics, logs, resources and attributes:
  <https://opentelemetry.io/docs/concepts/semantic-conventions/>
- standalone events should have a low-cardinality event name and attributes carrying structured
  context:
  <https://opentelemetry.io/docs/specs/semconv/general/events/>
- logs should be correlatable with traces through execution context and resource context:
  <https://opentelemetry.io/docs/specs/otel/logs/>
- Collector processors are the right place to transform, filter, enrich, batch, sample and redact
  telemetry before exporting:
  <https://opentelemetry.io/docs/collector/components/processor/>
- GenAI semantic conventions are still marked development; repo code must therefore avoid freezing
  unstable GenAI-specific vendor schema into contracts:
  <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/>

## Runtime Ownership Matrix

| Runtime / Layer | OTel SDK Allowed | Responsibility |
| ----------------- | ------------------ | ---------------- |
| `apps/execution-control` | yes | Online trace owner for request admission, orchestration, Temporal workflow/activity attempts, Go RAG/finalization workers, finalization, error and telemetry self-health |
| `apps/ingestion-control` | yes, or runtime event bridge | Emit offline task telemetry for canonicalize, parse/OCR, chunk, embedding, index release, publish and audit jobs |
| `apps/app-api` | limited | Request lifecycle telemetry, trace propagation and product-surface events emitted to controlled OTLP ingest; not retrieval or ingestion telemetry truth |
| Retrieval runtime seam | no | Vendor-neutral `RetrievalObservationSink` only |
| Knowledge / RAG runtime | runtime adapter only | Accept injected retrieval observation sink; no OTel/Sentry/Axiom dependency in contracts |
| `packages/ingestion-core` | no by default | Business/data-plane logic remains vendor-neutral; runtime shell adapts run outcomes into telemetry |
| `packages/contracts` | no | No OTel, Collector, Sentry or Axiom types |
| Controlled OTLP ingest gateway | yes, deployment edge | Authenticated Worker-origin OTLP HTTP ingress, method/path allowlist and payload size guard before Collector |
| OTel Collector / equivalent adapter | yes, deployment layer | Batching, retry, resource enrichment, attribute filtering, redaction, sampling and fan-out to sinks |
| Sentry | sink only | Error, trace and performance debugging |
| Axiom | sink only | High-volume structured runtime events, retrieval/ingestion analysis and quality slicing through Collector exporter |

## Signal Taxonomy

Event names are low-cardinality and stable. Dynamic identifiers belong in attributes only when
explicitly allowed below.

| Event / Span Family | Primary Owner | Signal Shape |
| --------------------- | --------------- | -------------- |
| `runtime.request.accepted` | `apps/execution-control`, `apps/app-api` | Request admitted, actor type, surface, capability, scope summary, trace/request correlation |
| `runtime.request.finalized` | `apps/execution-control`, `apps/app-api` | Request terminal status, selected capability/tool, duration, source count summary, fail-close reason |
| `runtime.request.transport_error` | `apps/app-api` | Product entry to supervisor transport failure |
| `agent.bridge.started` | `apps/execution-control` | Historical/offline bridge call admitted with lane, timeout and request correlation |
| `agent.bridge.completed` | `apps/execution-control` | Historical/offline bridge terminal outcome, duration, queue wait, retry/cancel status |
| `agent.bridge.failed` | `apps/execution-control` | Historical/offline bridge failure code, retryability and circuit-breaker decision |
| `execution.activity.started` | `apps/execution-control` / Go activity worker | Temporal activity attempt started with task queue, worker identity and request correlation |
| `execution.activity.completed` | `apps/execution-control` / Go activity worker | Temporal activity attempt terminal outcome, duration, schedule-to-start, token/cost and cancel/timeout outcome |
| `execution.activity.failed` | `apps/execution-control` / Go activity worker | Temporal activity attempt failure kind, retryability and terminal projection reason |
| `agent.tool.dispatched` | `apps/execution-control` / worker | Tool call selected by allowed runtime policy |
| `agent.tool.completed` | `apps/execution-control` / worker | Tool terminal state, latency and failure kind |
| `retrieval.runtime_observation` | `apps/execution-control` / `activity-worker-knowledge-retrieval` | Sanitized retrieval observation emitted from `RetrievalObservationSink` |
| `ingestion.run.started` | `apps/ingestion-control` | Offline ingestion/index run start with run id, source family, surface and collection |
| `ingestion.run.completed` | `apps/ingestion-control` | Run count summary, duration, cost estimate, release id and audit result |
| `ingestion.run.failed` | `apps/ingestion-control` | Run failure kind, stage and retryability |
| `index.release.audit` | `apps/ingestion-control` | Payload index, manifest, point payload and release guard audit result |
| `index.release.publish` | `apps/ingestion-control` | Alias/current pointer publish attempt and result |
| `telemetry.export.failed` | runtime / adapter | Exporter or sink failure; configured product answer paths fail closed |
| `telemetry.export.dropped` | runtime / adapter | Explicitly sampled telemetry count |

## Allowed Attribute Groups

### Resource Attributes

- `service.name`
- `service.version`
- `deployment.environment`
- `telemetry.schema_version`
- `telemetry.allowed_attributes_version`

### Correlation Attributes

- `trace_id`
- `span_id`
- `request_id`
- `conversation_id`
- `run_id`
- `plan_id`
- `step_id`
- `actor_id_hash`
- `principal_type`

### Runtime / Request Attributes

- `surface`
- `lane`
- `requested_capability`
- `requested_scope`
- `requested_scope_summary`
- `selected_capability`
- `selected_tool`
- `status`
- `outcome`
- `terminal_outcome`
- `fail_close_reason`
- `failure_kind`
- `error.type`
- `duration_ms`
- `queue_wait_ms`
- `retryable`
- `http_status`
- `sample_ratio`

### Retrieval Attributes

- `scope.corpus`
- `scope.collection`
- `query_mode`
- `retrieval_mode`
- `release_id`
- `profile_hash`
- `terminal_state`
- `failure_kind`
- `candidate_count`
- `reference_count`
- `latency_ms`
- `query_sha256`
- `top_score`
- `score_gap`
- `target_document_ids_count`
- `target_version_ids_count`
- `canonical_index_truth`
- `source_timestamps_count`
- `as_of`
- `no_hit`
- `low_confidence`
- `release_metadata_drift`
- `reranker_failed`
- `reranker_failure_kind`

`top_source_ids` and other document identifiers may be recorded only in event/log payloads with a
small bounded count for debugging sinks. They must not be promoted to metric labels.

### Ingestion / Index Attributes

- `run_id`
- `operation`
- `stage`
- `source_family`
- `import_source`
- `surface`
- `corpus`
- `collection`
- `status`
- `document_count`
- `document_unit_count`
- `chunk_count`
- `point_count`
- `embedding_model`
- `embedding_call_count`
- `embedding_cache_hit_count`
- `embedding_cache_miss_count`
- `embedding_provider_call_count`
- `qdrant_upsert_count`
- `payload_index_count`
- `release_id`
- `preparation_run_id`
- `profile_hash`
- `validation_status`
- `quality_gate_status`
- `retrieval_acceptance_status`
- `post_publish_audit_status`
- `audit_result`
- `failure_kind`
- `duration_ms`
- `cost_estimate_microusd`
- `publish_alias`
- `published`
- `reset_index`
- `selection_mode`

### Telemetry Self-Health Attributes

- `telemetry.enabled`
- `telemetry.exporter_configured`
- `telemetry.exporter_name`
- `telemetry.exported_count`
- `telemetry.dropped_count`
- `telemetry.failed_count`
- `telemetry.last_error_kind`
- `telemetry.sample_ratio`

## Forbidden Fields

The following must not be sent to OTel attributes, event bodies, Sentry contexts or Axiom events by
default:

- raw prompt
- raw query text
- raw answer
- raw chat transcript
- raw retrieved snippet
- chunk body
- canonical document body
- OCR/raw parser text
- raw long-term memory
- raw JWT
- cookie
- authorization header
- access envelope
- SSO / authenticated portal token
- API key
- database URL with credentials
- object store secret
- provider secret
- phone number, email, student id or national id in clear text
- full exporter endpoint URL if it contains credentials or query tokens

Any temporary debug override must be explicit, bounded, documented, disabled by default and excluded
from production sink configuration.

## Metrics Derived From Events

Runtime adapters or Collector/backend aggregation may derive these low-cardinality metrics:

- request count by surface/capability/status
- request latency histogram
- bridge latency and queue wait histogram
- retrieval count by corpus/collection/query mode/retrieval mode/terminal state
- retrieval no-hit / low-confidence / forbidden-hit count
- release metadata drift count
- reranker failed count
- ingestion run count by source family/collection/status
- chunk and embedding count summary
- embedding cache hit/miss count
- index publish/audit success and failure count
- telemetry exported/sampled-dropped/failed count

Raw document ids, raw query hashes and source urls must not become metric labels.

## Focused Verification Expectations

Phase implementations must add or maintain tests for:

- disabled telemetry is a no-op
- missing endpoint when enabled reports degraded telemetry health and fails closed on configured product paths
- exporter/sink failure fails closed on configured product paths
- forbidden fields are absent from emitted attributes
- `query_sha256` is present when retrieval observation is emitted
- trace/request correlation propagates across app-api, execution-control and worker boundaries
- ingestion run telemetry summarizes counts and failure kind without raw body text
- Collector/adapter config performs attribute filtering/redaction before sink export
