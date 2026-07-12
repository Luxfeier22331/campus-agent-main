---
doc_type: contract
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-07-11
---
# Langfuse Runtime Observability Contract

## Contract Boundary

This contract defines the safe telemetry that may reach Langfuse through the
OTel Collector. It does not define app-api HTTP shapes, Temporal history or
shared DTOs.

Langfuse receives two kinds of data:

- sanitized runtime traces emitted as standard OTLP;
- datasets, annotations and scores written by `packages/eval-langfuse`.

Neither kind becomes product truth, Temporal truth or release authority.

## Transport

- Runtime services export OTLP to the environment-owned Collector endpoint.
- Only the Collector stores Langfuse ingestion credentials and exports to the
  Langfuse OTLP endpoint.
- Runtime services must not construct Langfuse URLs, authorization headers or
  sink-specific deep links.
- `traceparent`, `tracestate` and `baggage` use W3C propagation across HTTP and
  Temporal boundaries.
- OTLP export failure must not fail an online answer.

## Safe Trace Fields

Langfuse-bound traces may include:

- service name, version, release and deployment environment;
- request, conversation, run, workflow, trace, span, step and activity ids;
- route template, task queue, activity attempt and terminal status;
- agent, handoff, guardrail and tool names;
- model/provider identity and provider response id;
- token counts and bounded duration fields;
- selected tool, source count, failure class and fail-close reason;
- safe hash and version fields from `llm_io_fingerprint.v1` and
  `answer_eval_fingerprint.v1`.

Repo-owned `stage_timing.v1` remains the canonical request-stage latency
projection. External spans may diagnose latency but do not replace it.

## Agents SDK Mapping

`apps/agent-runtime` must:

- set `traceIncludeSensitiveData=false`;
- replace the SDK default exporter with the repo-owned OTel processor;
- map SDK data through an allowlist rather than serializing SDK span objects;
- preserve the inbound active OTel context as the parent context;
- export through the standard OTLP HTTP exporter outside request callbacks.

The safe mapping may emit agent/tool/model names, response ids, token counts and
error status. It must not emit rendered messages, generated text, tool
arguments, tool results, guardrail payloads, source bodies or memory text.

## Eval Projection

Ragas and deterministic scorer inputs may contain only data approved for eval
storage:

- case, trace, observation and dataset item identity;
- question, answer and retrieved/reference contexts from approved datasets or
  sanitized trace projection;
- retrieved/reference context ids;
- metric applicability and release metadata;
- sanitized `tool_trajectory.v1` fields.

Unknown score names, missing correlation, incomplete dataset materialization or
forbidden fields must fail closed. Score metadata must remain bounded and must
not copy trace or source bodies.

## Forbidden Payloads

The following values must not enter runtime OTLP, Langfuse score metadata,
app-api observability projection or Operator Console responses:

- raw prompts, generated answers or transcripts;
- provider request/response bodies or stream deltas;
- tool arguments/results and retrieved source bodies;
- raw memory text or Hindsight internal ids/refs;
- cookies, JWTs, authorization headers, API keys and provider secrets;
- database URLs and object-store credentials;
- unbounded error text or user identifiers as metric labels.

## Verification

- Agent-runtime tests verify the allowlisted span mapping and sensitive-data
  exclusion.
- Execution-control tests verify W3C propagation and safe finalization fields.
- Collector validation verifies OTLP routing, redaction and Langfuse export.
- `packages/eval-langfuse` tests verify trace identity and forbidden fields.

## Related Documents

- `docs/architecture/system/langfuse.md`
- `docs/contracts/stage-timing.md`
- `docs/contracts/tool-trajectory.md`
- `docs/reference/runtime-otel-telemetry-taxonomy.md`
- `docs/runbooks/runtime-otel-collector-pipeline.md`
