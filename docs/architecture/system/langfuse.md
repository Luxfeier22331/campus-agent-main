---
doc_type: architecture
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-07-11
---
# Langfuse Observability And Eval Architecture

## Core Conclusion

Langfuse is the LLM observability and eval platform for the online answer path.
It is not an execution runtime, product data store, operator query backend,
learning-loop warehouse or contract owner.

Runtime telemetry follows one vendor-neutral path:

```text
app-api -> execution-control -> Temporal workers -> agent-runtime
                                          |              |
                                          +---- OTLP ----+
                                                   |
                                             OTel Collector
                                                   |
                                                Langfuse
```

The Collector is the only runtime component that owns Langfuse ingestion
credentials and sink fan-out. Runtime processes emit standard OTLP and do not
call Langfuse APIs directly.

## Runtime Mapping

- W3C `traceparent` and `baggage` propagate across app-api,
  execution-control and agent-runtime.
- `request_id`, `run_id`, Temporal workflow id and `trace_id` correlate one
  answer across product projection, Temporal history and external traces.
- Temporal workflow/activity spans describe durable execution.
- OpenAI Agents SDK spans describe the primary agent, handoff, generation and
  tool loop inside the single Agent Activity.
- `stage_timing.v1`, `llm_io_fingerprint.v1` and
  `answer_eval_fingerprint.v1` remain repo-owned safe projections. Langfuse does
  not replace them.

The canonical diagnostic spine remains:

`Run -> RunEvent -> RunStep -> StepAttempt -> StepResult -> Finalization`

## Agent Runtime Telemetry

`apps/agent-runtime` disables the OpenAI Agents SDK default trace exporter and
installs one repo-owned tracing processor with `setTraceProcessors()`. The
processor maps allowlisted SDK span facts into OpenTelemetry spans and keeps
`traceIncludeSensitiveData=false`.

Allowed span facts include:

- agent, handoff, guardrail and tool names;
- model and operation identity;
- provider response id;
- input/output token counts;
- request, run and safe trace correlation.

Rendered prompts, model output, tool arguments/results, source bodies, memory
text and provider request/response bodies are not exported. There is no
request-scoped debug configuration, raw model-I/O capture or repo-owned LLM
replay data plane.

Telemetry export is asynchronous and must not block or fail an answer. Export
failures are operational degradation signals, not answer-path dependencies.

## Eval Platform Boundary

The active eval chain is:

```text
Langfuse traces / datasets + repo eval assets
-> packages/eval-langfuse safe projection
-> packages/ragas-runner upstream Ragas or deterministic TS scorer
-> Langfuse scores / annotation
```

- `packages/eval-langfuse` owns trace and dataset selection, safe Ragas
  projection, score publication, dataset manifests and trace verification.
- `packages/ragas-runner` is a narrow Python execution island for upstream
  Ragas metrics. It does not own orchestration, case truth or Langfuse writes.
- Agent tool-use eval consumes `tool_trajectory.v1` and deterministic TS
  scorers; it does not infer tool decisions from raw model payloads.
- Langfuse owns datasets, experiments, scores and annotation workflows, while
  the repo owns contracts, qrels, golden truth and release decisions.
- Online serving never depends on Langfuse availability.

## Product And Operator Boundary

App-api stores request correlation, stage timing and safe fingerprints. It does
not store Langfuse trace bodies, sink-specific trace links, raw SDK spans or
operator-managed tracing configuration. Operator Console uses repo-owned runtime
status and safe request projections; engineers use Langfuse directly for trace
inspection under platform access control.

## Related Documents

- `docs/contracts/langfuse-runtime.md`
- `docs/contracts/stage-timing.md`
- `docs/architecture/system/learning-loop.md`
- `docs/architecture/system/ops-observability.md`
- `docs/product/langfuse-evals.md`
- `docs/reference/runtime-otel-telemetry-taxonomy.md`
- `docs/decisions/adr-0059-langfuse-observability-and-eval-platform.md`
