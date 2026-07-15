---
doc_type: architecture
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-07-13
---
# Langfuse

## Boundary

Langfuse is the LLM observability and eval platform. It stores traces,
datasets, experiment runs, scores and annotation workflows. It is not an
execution runtime, product database, Temporal history store, contract owner or
release authority.

## Runtime Trace Path

```text
app-api W3C context
-> execution-control Go OTel spans
-> agent-runtime OpenAI Agents SDK instrumentation
-> standard OTLP exporter
-> Collector or Langfuse OTLP endpoint
-> Langfuse trace
```

Agent-runtime uses OpenInference instrumentation and the official
`@langfuse/otel` span processor. Execution-control uses the standard Go OTel
SDK. Both propagate `traceparent` and `baggage`; exporter endpoint, headers and
service name come from standard OTel configuration.

Langfuse unavailability must not block online answers. Temporal and PostgreSQL
sanitized projections remain lifecycle and diagnostic truth.

## Eval Path

```text
repo-authored Langfuse dataset item
-> real app-api / Temporal / Agent SDK execution
-> execution-control eval projection + product trace
-> official Langfuse dataset-run-item link
-> packages/eval-langfuse safe adapter
-> packages/ragas-runner official Ragas metrics collections
-> packages/eval-langfuse registered Langfuse scores
```

`packages/eval-langfuse` owns platform API adaptation, product-backed dataset
runs, dataset/score config sync, safe projection, dataset-run-item linking,
score publishing and trace verification.
`packages/ragas-runner` is a narrow Python library boundary that calls official
Ragas `ascore()` APIs. It does not own datasets, orchestration or release gates.

## Observation Ownership

`tool_trajectory.v2` owns public and internal tool-call facts.
`agent_runtime_eval_projection.v2` owns answer, retrieved contexts/document ids
and resolved targets derived from execution steps. Langfuse correlates those
facts through trace and dataset identity but does not redefine their schemas.

Repo datasets under `packages/eval-langfuse/assets/datasets/agent` and
`packages/eval-langfuse/assets/datasets/rag` are the versioned source for tool
trajectory, expected outcome, target sequence, search count, reference answer
and reference context ids. The unified manifest publishes
`campus/agent/routing` and `campus/rag/*` datasets for Langfuse experiments and
scoring.

Langfuse calculates model cost from model identity and token usage. Runtime OTel
and PostgreSQL projections do not maintain a parallel micro-USD estimate.

`packages/eval-langfuse` links each dataset item to the real product trace with
the official dataset-run-item API and retains the returned dataset run id as
internal lineage. Score writes use the synchronous scores REST API and target
exactly one observation or trace; dataset ids are not score target fields. It
does not use `runExperiment` to create a second synthetic trace.

## Data Boundary

Self-hosted Langfuse is a trusted internal observability plane. Sampled traces
may contain user/session association, model input/output, memory context and
authorized retrieved facts. Credentials and secrets remain forbidden.

App-api and Operator Console keep a separate bounded projection and never copy
Langfuse trace bodies. Score metadata is scalar and allowlisted; answer and
context text remain in trace, dataset and Ragas sample fields.

## Related Documents

- `../../contracts/langfuse-runtime.md`
- `../../reference/eval.md`
- `../../runbooks/eval-ragas.md`
- `../../decisions/adr-0062-ragas-langfuse.md`
- `../../decisions/adr-0076-langfuse-trace-data.md`
