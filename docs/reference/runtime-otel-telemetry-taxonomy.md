---
doc_type: reference
truth_scope: ops
owner_boundary: apps/execution-control
status: active
created: 2026-05-01
updated: 2026-07-06
---
# Runtime OTel Telemetry Taxonomy

## Boundary

This document freezes the repo-owned telemetry taxonomy for the runtime OTel
bridge. It defines where OTel SDKs are allowed, which runtime owns each signal,
which attributes are allowed, and which fields must never be sent to telemetry
sinks.

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
| `apps/execution-control` | yes | Online trace owner for request admission, four-phase Temporal workflow/activity attempts, internal queries, evidence/source validation, finalization, error and telemetry self-health |
| `apps/ingestion-control` | yes, or runtime event bridge | Emit offline task telemetry for canonicalize, parse/OCR, chunk, embedding, index release, publish and audit jobs |
| `apps/app-api` | limited | Request lifecycle telemetry, trace propagation and product-surface events emitted to protected Collector OTLP ingest; not retrieval or ingestion telemetry truth |
| Retrieval runtime seam | no | Vendor-neutral `RetrievalObservationSink` only |
| Knowledge search runtime | runtime adapter only | Emit sanitized search observations; no OTel/Sentry/Axiom dependency in contracts |
| `packages/ingest-core` | no by default | Runtime-neutral ingestion helper logic remains vendor-neutral; runtime shell adapts run outcomes into telemetry |
| `packages/contracts` | no | No OTel, Collector, Sentry or Axiom types |
| Protected Collector OTLP HTTP receiver | yes, deployment edge | Authenticated Worker-origin OTLP HTTP ingress before the Collector pipeline |
| OTel Collector | yes, deployment layer | Batching, retry, resource enrichment, attribute filtering, redaction, sampling and fan-out to sinks |
| Sentry | sink only | Error, trace and performance debugging; not an Operator Console database |
| Axiom | sink only | Runtime logs/events, query dashboards and trend analysis through Collector exporter; not an app-api dashboard cache |
| Langfuse | sink/platform only | LLM traces, controlled debug observations, datasets, scores and review workflows; not an app-api score or trace store |

## Signal Taxonomy

Event names are low-cardinality and stable. Dynamic identifiers belong in attributes only when
explicitly allowed below.

Runtime observability has three data classes:

- `safe telemetry`: sanitized OTel/log/metric/event data, repo observations,
  stage timing and sink correlation. This is the default class for app-api,
  Operator Console, Sentry, Axiom and Langfuse repo observations.
- `restricted raw debug trace`: model/tool/provider trace detail admitted by
  request-scoped `raw_capture_policy.v1` and sent only to controlled debug
  sinks.
- `replay artifact`: `llm_replay_packet.v1` raw or near-raw packet stored in
  encrypted S3-compatible object storage with index, TTL, checksum, access
  audit and deletion linkage.

Metrics, log labels, repo-owned OTel attributes and Operator projections use
safe telemetry only. Restricted raw trace and replay artifact bodies are never
metric labels or app-api projection payloads.

Replay-related safe telemetry may reference prompt registry attestation,
primary attestation, tool runtime attestation, provider request safe hash, model
params projection, evidence replay index refs, replay retention refs and access
audit refs as metadata. These refs identify controlled artifacts and decisions;
they do not authorize raw replay packet body export through telemetry.

| Event / Span Family | Primary Owner | Signal Shape |
| --------------------- | --------------- | -------------- |
| `runtime.request.accepted` | `apps/execution-control`, `apps/app-api` | Request admitted, actor type, surface, requested tool, scope summary, trace/request correlation |
| `runtime.request.finalized` | `apps/execution-control`, `apps/app-api` | Request terminal status, selected tool, duration, source count summary, fail-close reason |
| `runtime.request.transport_error` | `apps/app-api` | Product entry to execution-control private upstream transport failure |
| `execution.activity.started` | `apps/execution-control` / Go activity worker | Temporal activity attempt started with task queue, worker identity and request correlation |
| `execution.activity.completed` | `apps/execution-control` / Go activity worker | Temporal activity attempt terminal outcome, duration, schedule-to-start, token/cost and cancel/timeout outcome |
| `execution.activity.failed` | `apps/execution-control` / Go activity worker | Temporal activity attempt failure kind, retryability and terminal projection reason |
| `agent.tool.dispatched` | `apps/execution-control` / worker | Tool call selected by allowed runtime policy |
| `agent.tool.completed` | `apps/execution-control` / worker | Tool terminal state, latency and failure kind |
| `retrieval.runtime_observation` | `apps/execution-control` / internal `knowledge_search` | Sanitized scope/version, latency, evidence-count and outcome observation |
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
- `requested_tool`
- `knowledge_scope`
- `knowledge_scope_summary`
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

### LLM Replay Safe Attributes

- `llm.call_site`
- `llm.provider`
- `llm.model`
- `llm.prompt_id`
- `llm.prompt_registry_version`
- `llm.prompt_template_sha256`
- `llm.rendered_prompt_sha256`
- `llm.model_params_hash`
- `llm.provider_request_safe_hash`
- `llm.tool_runtime_combined_sha256`
- `llm.primary_attestation_kind`
- `replay.packet_id`
- `replay.packet_index_ref`
- `replay.retention_class`
- `replay.access_audit_ref`
- `replay.evidence_ref_count`

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

The following must not be sent to repo-owned runtime OTel attributes, event
bodies, Sentry contexts or Axiom events by default:

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
- provider request safe-hash canonicalization input
- model params projection input before allowlist filtering
- replay retention deletion subject in clear text
- replay access-audit body

Any temporary debug override must be explicit, bounded, documented, disabled by
default and excluded from safe telemetry projections.

Controlled debug trace and replay artifact lanes are the only allowed exception
for raw or near-raw model input/output. They are defined by
`../contracts/langfuse-runtime.md` and `../contracts/replay-capture.md`, and must
be admitted by request-scoped `raw_capture_policy.v1`. The exception never
applies to app-api runtime events, Operator Console read models, Temporal
metadata, repo-owned run/step projections, score metadata or metrics labels.
Secrets, credentials, auth material, cookies, JWTs, database URLs,
object-store secrets and raw Hindsight refs remain forbidden in every lane.

Current LLM debug trace implementation exports only to Langfuse OTLP when an
app-api-owned operator config is projected through execution-control and passed
request-scoped to agent-runtime. Agent-runtime does not own environment
variables for this behavior. The repo-owned projection surface may carry only
safe `debug_trace_refs`, `stage_timing.v1` fields, replay packet metadata, safe
replay index refs and replay attestation metadata defined in
`../contracts/stage-timing.md` and `../contracts/replay-capture.md`; raw OTLP
bodies, SDK trace payloads and replay packet bodies stay in their controlled
sink/artifact lanes.

## Stage Timing Projection

`stage_timing.v1` is the repo-owned request latency projection. It is not an
OTel schema, Langfuse trace body, SDK trace payload or Temporal history shape.

Allowed timing fields are fixed by `../contracts/stage-timing.md`. Runtime
adapters and Collector/backend aggregation may derive low-cardinality latency
histograms from those fields, using the field name as a bounded stage label.
They must not derive metric labels from request ids, user ids, raw URLs, raw
errors, arbitrary tool names or vendor span names.

Provider-internal queue timing is not a required repo-owned field. If an
external sink exposes provider queue detail, it remains debug-sink detail unless
an explicit contract admits a safe projection.

App-api emits `request.stage_timing` as the bounded runtime event for this
projection. Each event may contain only:

- `stage_field`: canonical `stage_timing.v1` field
- `duration_ms`: finite non-negative duration
- `budget_state`: `within_budget`, `warn` or `critical`
- normal request correlation fields admitted by the runtime event sanitizer

The event must not carry raw SDK spans, provider queue internals, raw model IO,
raw retrieval snippets or Temporal history.

The app-api OTLP adapter also emits `campus.app_api.stage_duration_ms` for
`request.stage_timing`. Its metric attributes are limited to `stage_field`,
`surface`, `status`, `selected_tool` and `budget_state`; request ids and trace
ids remain trace/log correlation fields, not metric labels.

## Metrics Derived From Events

Runtime adapters or Collector/backend aggregation may derive these low-cardinality metrics:

- request count by surface/tool/status
- request latency histogram
- stage timing histogram by `stage_timing.v1` field
- execution-control activity duration, queue wait and schedule-to-start
  histograms:
  - `campus.execution_control.activity_duration_ms`
  - `campus.execution_control.queue_wait_ms`
  - `campus.execution_control.schedule_to_start_ms`
- execution-control runtime request/error counters:
  - `campus.execution_control.runtime_requests`
  - `campus.execution_control.runtime_errors`
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

Runtime implementations must add or maintain tests for:

- disabled telemetry is a no-op
- missing endpoint when enabled reports degraded telemetry health and fails closed on configured product paths
- exporter/sink failure fails closed on configured product paths
- forbidden fields are absent from emitted attributes
- `query_sha256` is present when retrieval observation is emitted
- trace/request correlation propagates across app-api, execution-control and worker boundaries
- ingestion run telemetry summarizes counts and failure kind without raw body text
- Collector/adapter config performs attribute filtering/redaction before sink export
