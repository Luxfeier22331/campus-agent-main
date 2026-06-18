---
doc_type: architecture
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-06-18
---
# Langfuse Observability And Eval Architecture

## Core Conclusion

Langfuse is the LLM observability and eval platform for the online answer path.
It is not an execution runtime, product data store, operator query backend or
contract owner.

The target runtime chain is:

`app-api -> execution-control -> Temporal workflow/activity workers -> OTel
Collector -> Langfuse`

The target eval chain is:

`packages/evals -> app-api internal eval ingress -> deterministic scorer ->
Langfuse dataset / experiment / score`

## Runtime Mapping

- `conversation_id` maps to Langfuse session id.
- `request_id` / `run_id` / Temporal workflow id map to trace metadata.
- Temporal workflow execution maps to one Langfuse trace.
- Temporal activity or repo step projection maps to a Langfuse observation.
- user feedback, eval grades and badcase review map to Langfuse scores.

The canonical diagnostic spine remains:

`Run -> RunEvent -> RunStep -> StepAttempt -> StepResult -> Finalization`

Langfuse may help inspect the same run, but it does not replace the spine.

## Attribute Boundary

Langfuse-bound telemetry must be sanitized before exporter fan-out.

Allowed fields include:

- trace/session identity: `langfuse.session.id`, `langfuse.user.id`,
  `langfuse.trace.name`, `langfuse.release`, `langfuse.trace.tags`
- run identity: `request_id`, `run_id`, `workflow_id`, `trace_id`
- step identity: `step_id`, `step_kind`, `activity_type`, `task_queue`,
  `activity_attempt`
- result summary: `status`, `duration_ms`, `schedule_to_start_ms`,
  `projection_ref`, `fail_close_reason`
- RAG summary: collection, retrieval mode, candidate count, reference count,
  citation coverage and grounding status

Forbidden fields include raw prompt, raw answer, raw transcript, raw retrieved
snippet, provider raw response, cookies, JWT, authorization headers, API keys,
database URLs and object-store/provider secrets.

## Temporal Collaboration

Temporal owns workflow history, retry, timeout, heartbeat, signal, cancel and
task queue dispatch. Langfuse consumes OTel spans emitted at runtime boundaries.

The skeleton exposes a Temporal tracing configuration seam. The production
implementation should attach the Temporal Go SDK OpenTelemetry tracing
interceptor through that seam, then continue emitting repo-owned step projection
and safe attributes for product diagnostics.

## Eval Platform Boundary

Langfuse datasets and experiments help run and compare evals. They do not own
the repo's eval truth.

- `packages/evals` owns case schema, fixture loading, deterministic scoring and
  release verdicts.
- Langfuse stores experiment runs, item scores and review workflow artifacts.
- CI gates may use Langfuse experiment output, but must fail closed when the
  repo-owned scorer or adapter reports missing configuration or incomplete
  results.
