---
doc_type: architecture
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-07-05
---
# Langfuse Observability And Eval Architecture

## Core Conclusion

Langfuse is the LLM observability and eval platform for the online answer path.
It is not an execution runtime, product data store, operator query backend,
learning-loop warehouse or contract owner. User-usage continuous improvement is
owned by `learning-loop.md`; this document owns the Langfuse platform boundary.

The runtime chain is:

`app-api -> execution-control -> Temporal workflow/activity workers -> OTel
Collector -> Langfuse`

The target eval platform chain is:

`Langfuse traces / datasets + repo assets / qrels / review policy +
policy-admitted replay artifacts -> safe eval projection or restricted
replay-backed eval -> Ragas / TS eval runner -> Langfuse scores / annotation ->
app-api sanitized projection or backlink`

The broader learning loop is:

`online usage -> safe projection / trace refs / feedback / optional
raw_capture_policy.v1-admitted replay packet -> candidate selection -> Langfuse
annotation / dataset / scores -> improvement action -> offline eval / experiment
or replay diff -> release -> post-release comparison`

That loop is defined in `learning-loop.md`. This document only defines how
Langfuse participates in it.

RAGAS is used as an eval scorer, not as trace truth. The default scorer path
uses Ragas `metrics.collections` and direct metric `score` / `ascore` execution.
Deprecated `ragas.evaluate()` usage is limited to explicit tests or staged
repair callers that inject the deprecated function.

Agent tool-use eval uses the repo-owned `tool_trajectory.v1` contract plus
deterministic TS scorers. It does not use RAGAS and does not ask Langfuse to
own routing, tool arguments or source-policy contracts.

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

Langfuse-bound `repo_observation` telemetry must be sanitized before exporter
fan-out. `llm_debug_trace` and restricted replay-backed eval are separate
controlled lanes; they may contain raw or near-raw LLM I/O only when admitted by
`raw_capture_policy.v1` in `docs/contracts/replay-capture.md`.

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

Forbidden fields for `repo_observation`, score metadata and default safe eval
projection include raw prompt, raw answer, raw transcript, unrestricted source
body, raw retrieved snippet, raw retrieved backend dump, raw memory text,
Hindsight bank / operation / runtime document refs, provider raw response,
cookies, JWT, authorization headers, API keys, database URLs and
object-store/provider secrets. Eval-safe input, answer and context excerpts may
be exported only through explicit allowlisted projection fields.

Restricted debug and replay lanes are narrower than product observability:

- `llm_debug_trace` may carry model / tool / provider details inside controlled
  Langfuse / OpenAI / OTel sinks only when a request-scoped
  `raw_capture_policy.v1` admits the fields.
- `llm_replay_packet.v1` is the canonical repo-owned replay artifact identity,
  TTL, checksum and deletion-linkage contract. Langfuse trace bodies do not
  become canonical replay packets.
- App-api, Operator Console, Temporal metadata, repo-owned run / step
  projections and score metadata must not inline raw replay packet bodies.
- Secrets, auth material, credentials and raw Hindsight refs remain forbidden in
  every lane.

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
  projection, tool-trajectory consumption, score publishing, dataset manifests
  and annotation automation.
- Agent tool-use eval follows the repo contract shape:
  `tool_trajectory.v1 -> deterministic TS scorer -> Langfuse agent/tool scores`.
  It may use Langfuse datasets, runs, scores and annotation queues, but the repo
  owns case truth, safe projection and score semantics.
- RAGAS follows the official Langfuse collaboration shape:
  `Langfuse traces / datasets -> Ragas evaluation -> Langfuse scores`.
  `packages/eval-langfuse` owns trace / dataset selection and safe projection.
  Offline / CI runs may still use sanitized `ragas_sample_batch.v1`.
- `packages/ragas-runner` is a narrow Python execution island for mature RAGAS
  library scoring only. It accepts safe projection input, emits
  `ragas_score_batch.v1`, and does not own case truth, trace selection,
  orchestration, Langfuse publishing, provider projection or release verdicts.
- The old `packages/evals` package is retired from active workspace ownership.
  Langfuse-bound eval assets and qrels live under `packages/eval-langfuse/assets`;
  runtime-local eval truth lives with the owning runtime testdata. Recreating
  `packages/evals` as a fixture, runner or Python package is outside the accepted
  eval architecture.
- Langfuse stores dataset, experiment, score and review workflow artifacts.
- Langfuse consumes sanitized artifacts, datasets, experiments, scores,
  annotations, trace drill-down metadata and Ragas-safe eval projection by
  default. Restricted raw debug traces or replay-backed eval payloads may enter
  Langfuse only through `raw_capture_policy.v1`; they must not be mirrored into
  score metadata, app-api projections or Operator Console payloads.
- The repo remains the owner for canonical qrels / golden truth, business
  contract truth, authz / privacy boundaries, minimal app-api Ops Index and
  fail-closed release verdicts.
- `app-api` and Operator Console may consume only repo-owned request
  correlation, runtime state and safe sink-link summaries. They must not query
  Langfuse directly, copy Langfuse observations into app-api, or recreate the
  old eval backlink projection.
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
- ADR-0069 narrows the former blanket raw-payload prohibition: safe projection
  remains raw-free, while restricted raw replay / capture is allowed only in the
  separate policy-governed data plane defined by
  `docs/contracts/replay-capture.md`.

Trace closeout is tool/domain-aware: a memory-enabled product path must prove
the corresponding repo-owned observations exist, starting with `memory.recall`.
When a flow evaluates retain materialization or reflection, closeout may require
`memory.append`, `memory.operation_status` or `memory.reflect` as explicit step
ids rather than inferring success from trace presence alone.

## Related Documents

- `docs/contracts/langfuse-runtime.md`
- `docs/contracts/replay-capture.md`
- `docs/contracts/stage-timing.md`
- `docs/architecture/system/learning-loop.md`
- `docs/product/langfuse-evals.md`
- `docs/decisions/adr-0059-langfuse-observability-and-eval-platform.md`
- `docs/decisions/adr-0069-raw-replay-capture.md`
