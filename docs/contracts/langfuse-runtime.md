---
doc_type: contract
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-07-12
---
# Langfuse Runtime

## Boundary

Langfuse consumes OpenTelemetry traces and eval scores. It does not own product
HTTP contracts, Temporal lifecycle, PostgreSQL run projection or repo dataset
truth.

## Runtime Integration

Execution-control emits sanitized Go OTel spans through the standard OTLP HTTP
exporter. Agent-runtime uses:

- OpenInference instrumentation for OpenAI Agents SDK;
- the official `@langfuse/otel` span processor;
- the standard OpenTelemetry Node tracer provider and OTLP exporter.

Services propagate W3C `traceparent` and `baggage`. Exporter destination and
headers come from standard `OTEL_EXPORTER_OTLP_*` environment variables;
`OTEL_SERVICE_NAME` identifies the service. Request payloads and app-api
observability configuration do not carry Langfuse endpoint or Basic Auth.

Providers flush on process shutdown, not after every span or request.

## Trace Activation And Correlation

Tracing is deployment-owned and process-scoped. Agent-runtime starts the
official instrumentation when a standard OTLP traces endpoint is configured;
without an exporter it runs without telemetry. Product requests do not carry
an observability mode, sample ratio, exporter configuration or sink reference.

An enabled trace includes OpenAI Agents SDK model input/output through the
official instrumentation path. The propagated W3C trace id is the correlation
key used by product projections and eval jobs. Product contracts do not store
Langfuse URLs, synthetic trace refs or delivery proof for any sink.

## Trace Data

Self-hosted Langfuse is a trusted internal observability system. A sampled trace
may contain user/session association, model input/output, memory context and
authorized retrieval facts needed to inspect the real agent execution.
Credentials and secrets such as authorization headers, cookies, API keys,
passwords, database credentials and object-store secrets are forbidden.

App-api, Ops Web and Operator Console do not copy Langfuse trace bodies. Their
PostgreSQL projection remains bounded to correlation identity, model/provider
identity, `agent_runtime_prompt_trace.v1` and stage timing. A trace correlation
field does not prove successful export or storage in Langfuse.

`tool_trajectory.v2` and `agent_runtime_eval_projection.v2` remain repo-owned
contracts. Langfuse can store correlated traces and scores but cannot redefine
those shapes.

## Dataset Runs And Scores

Dataset evaluation executes the real product path. For each target turn,
`packages/eval-langfuse`:

1. keeps optional setup turns in one product conversation;
1. reads `agent_runtime_eval_projection.v2` from the completed run;
1. derives the Langfuse trace id from the product trace id;
1. creates `/api/public/dataset-run-items` with `runName`, `datasetItemId` and
   the real trace id;
1. retains the returned dataset run identity as internal case lineage;
1. sends RAG and agent samples to the narrow Ragas runner and publishes the
   registered scores.

The runner does not use Langfuse `runExperiment`, because the product request
already created the canonical trace and a second experiment callback would
create a synthetic execution trace.

`packages/eval-langfuse` publishes scores synchronously through
`POST /api/public/scores`. Each payload targets exactly one Langfuse object: an
observation when one was materialized, otherwise its trace. `datasetItemId` and
`datasetRunId` are dataset-run lineage and are not score API target fields. The
active families are Ragas RAG metrics, Ragas agent/tool metrics,
`execution.outcome_match` and `retrieval.forbidden_context_absent`.

Unknown score names, missing correlation or Langfuse write failures fail the
publishing command. Score metadata is allowlisted and remains scalar; answer
and context text belong in the dataset item, product trace and Ragas sample,
not score metadata.

## Availability

Langfuse export and eval commands are offline observability work. Langfuse
availability never blocks online answer completion; Temporal and PostgreSQL
remain execution lifecycle truth.
