---
doc_type: architecture
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-06-29
---
# Langfuse Observability And Eval Architecture

## Core Conclusion

Langfuse is the LLM observability and eval platform for the online answer path.
It is not an execution runtime, product data store, operator query backend or
contract owner.

The runtime chain is:

`app-api -> execution-control -> Temporal workflow/activity workers -> OTel
Collector -> Langfuse`

The target eval platform chain is:

`Langfuse traces / datasets + repo fixture / qrels / review policy -> safe eval
projection -> Ragas / TS eval runner -> Langfuse scores / annotation ->
app-api sanitized projection or backlink`

RAGAS is used as an eval scorer, not as trace truth. The default scorer path
uses Ragas `metrics.collections` and direct metric `score` / `ascore` execution.
Deprecated `ragas.evaluate()` usage is limited to explicit compatibility tests
or staged repair callers that inject the legacy function.

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
- RAG summary and safe eval projection: collection, retrieval mode, candidate
  count, reference count, citation coverage, grounding status, retrieved /
  reference context ids and eval-safe context excerpts when explicitly admitted

Forbidden fields include raw prompt, raw answer, raw transcript, unrestricted
source body, raw retrieved snippet, raw retrieved backend dump, raw memory text,
Hindsight bank / operation / runtime document refs, provider raw response,
cookies, JWT, authorization headers, API keys, database URLs and
object-store/provider secrets. Eval-safe input, answer and context excerpts may
be exported only through explicit allowlisted projection fields.

## Temporal Collaboration

Temporal owns workflow history, retry, timeout, heartbeat, signal, cancel and
task queue dispatch. Langfuse consumes OTel spans emitted at runtime boundaries.

`execution-control` attaches the Temporal Go SDK OpenTelemetry tracing
interceptor to both Temporal clients and workers when
`otel.temporal_tracing_enabled=true`. The interceptor uses the repo-owned OTel
provider and Collector endpoint configured by the execution-control runtime
profile.

The Collector remains the fan-out boundary. Runtime code emits sanitized OTel
data to the Collector; it does not write Langfuse directly.

## Eval Platform Boundary

Langfuse datasets, experiments, scores, score configs, annotation queues and
score analytics help run, compare, review and inspect evals. They do not own the
repo's eval truth.

- `packages/eval-langfuse` owns TS Langfuse platform sync, safe Ragas
  projection, score publishing, dataset manifests and annotation automation.
- RAGAS follows the official Langfuse collaboration shape:
  `Langfuse traces / datasets -> Ragas evaluation -> Langfuse scores`.
  `packages/eval-langfuse` owns trace / dataset selection and safe projection.
  Offline / CI runs may still use sanitized `ragas_sample_batch.v1`.
- `packages/ragas-runner` is a narrow Python execution island for mature RAGAS
  library scoring only. It accepts safe projection input, emits
  `ragas_score_batch.v1`, and does not own case truth, trace selection,
  orchestration, Langfuse publishing, provider projection or release verdicts.
- The old `packages/evals` package is retired from active workspace ownership.
  Langfuse-bound fixtures and qrels live under `packages/eval-langfuse/fixtures`;
  runtime-local eval truth lives with the owning runtime testdata. Recreating
  `packages/evals` as a fixture, runner or Python package is outside the accepted
  eval architecture.
- Langfuse stores dataset, experiment, score and review workflow artifacts.
- Langfuse consumes sanitized artifacts, datasets, experiments, scores,
  annotations, trace drill-down metadata and Ragas-safe eval projection. It must
  not receive raw prompt, raw transcript, unrestricted source body, provider raw
  response or secrets.
- The repo remains the owner for canonical qrels / golden truth, business
  contract truth, authz / privacy boundaries, sanitized app-api / operator
  projection and fail-closed release verdicts.
- `app-api` and Operator Console may consume only repo-owned sanitized runtime
  and quality projections. They must not query Langfuse directly, and the old
  eval backlink projection must not be recreated.
- Eval lanes do not orchestrate production workflow execution. Temporal and
  `execution-control` remain the owners for workflow history, retry, timeout,
  signal, cancel and task queue dispatch.
- CI gates may use Langfuse experiment output, but must fail closed when the
  repo-owned scorer or adapter reports missing configuration, denominator drift
  or incomplete results.
- ADR-0061 freezes the eval runtime migration: TypeScript plus Langfuse is the
  long-term default, the old `packages/evals` package is retired, and RAGAS is
  isolated in `packages/ragas-runner`. ADR-0062 supersedes the earlier
  artifact-only RAGAS input assumption and aligns RAGAS with the official
  Langfuse trace / dataset scoring workflow.

Trace closeout is capability-aware: a memory-enabled product path must prove
the corresponding repo-owned observations exist, starting with `memory.recall`.
When a flow evaluates retain materialization or reflection, closeout may require
`memory.append`, `memory.operation_status` or `memory.reflect` as explicit step
ids rather than inferring success from trace presence alone.
