---
doc_type: contract
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-06-29
---
# Langfuse Runtime Observability Contract

## Contract Boundary

This contract defines how repo-owned runtime observations and controlled LLM
debug traces may be exported to Langfuse. It does not define app-api public HTTP
shape, Temporal history shape or `packages/contracts` DTOs.

Eval score publishing uses the same boundary: `packages/eval-langfuse` may write
sanitized score payloads to Langfuse, but Langfuse score schemas do not become
repo DTOs and must not leak into `packages/contracts`.

RAGAS score publishing may be based on Langfuse traces, Langfuse datasets,
repo-owned safe eval artifacts or golden dataset execution results. Langfuse
traces and datasets may act as RAGAS sample sources only through repo-owned safe
eval projection fields; score inputs and score metadata must not expose raw
prompt, raw transcript, unrestricted source body, provider raw response or
secrets.

Langfuse has two distinct lanes in this repo:

- `repo_observation`: sanitized repo-owned workflow / activity observations
  used for correlation, latency, step evidence and eval selection.
- `llm_debug_trace`: controlled model/tool/provider observations used for LLM
  debugging, eval review and latency diagnosis.

Only the first lane can be mirrored into app-api/operator-safe projections. The
second lane may contain raw or near-raw LLM input/output only inside controlled
Langfuse/OpenAI/OTel sinks with environment policy, RBAC, retention, sampling
and masking. It is not product truth, not Temporal truth, not app-api read model
truth and not a `packages/contracts` DTO.

RAGAS runtime scoring defaults to the Ragas `metrics.collections` API. Legacy
`ragas.evaluate()` is a compatibility island only for explicitly injected test /
repair callers and must not be treated as the default production scorer path.

## Trace Attributes

Every Langfuse-bound online answer trace should provide:

- `langfuse.trace.name`: `online-answer`
- `langfuse.session.id`: app-api conversation id when available
- `langfuse.user.id`: stable non-PII user identifier
- `langfuse.release`: runtime release identifier
- `langfuse.trace.tags`: surface, tool and environment tags
- `request_id`
- `run_id`
- `workflow_id`
- `trace_id`

## Repo Observation Attributes

Every repo-owned Langfuse-bound workflow/activity observation should provide:

- `step_id`
- `step_kind`
- `activity_type`
- `task_queue`
- `activity_attempt`
- `selected_tool`
- `status`
- `duration_ms`
- `schedule_to_start_ms`
- `projection_ref`
- `fail_close_reason`

RAG observations may additionally provide safe summary counts, categorical
states and Ragas-safe eval projection fields.

Ragas-safe eval projection fields are explicitly allowlisted:

- `eval.case_id`
- `eval.dataset_item_id`
- `eval.question`
- `eval.answer`
- `eval.retrieved_context_ids`
- `eval.reference_context_ids`
- `eval.retrieved_contexts`
- `eval.reference_contexts`
- `eval.metric_applicability`

`eval.question`, `eval.answer`, `eval.retrieved_contexts` and
`eval.reference_contexts` must be sanitized eval text, not raw prompt,
unrestricted source body, raw transcript or provider raw response. Prefer ids
over text whenever ids are sufficient for the selected Ragas metric.

Run context envelope observations may additionally provide:

- `context_envelope_schema_version`
- `context_recent_turn_count`
- `context_previous_evidence_count`
- `context_model_visible_item_count`
- `context_runtime_only_item_count`
- `context_token_estimate`
- `context_truncation_reason`
- `memory_recall_state`

RAG follow-up observations may additionally provide:

- `query_rewrite_hash`
- `query_rewrite_resolution_state`
- `followup_reference_type`
- `previous_evidence_reuse_decision`
- `selected_evidence_count`

Memory-enabled online traces must include the repo-owned `memory.recall`
observation when `context.memory.enabled=true`. Product-path closeout evidence
may additionally require `memory.append`, `memory.operation_status` or
`memory.reflect` observations when the evaluated flow exercises those runtime
operations.

Repo-owned observations must remain sanitized. They must not carry raw prompt,
raw answer, raw transcript, provider raw response, raw retrieved snippet,
unrestricted source body, raw memory text or auth material. They are the only
Langfuse lane eligible for app-api/operator-safe summary projection.

## LLM Debug Trace Lane

LLM debug observations may be exported by SDK tracing, provider instrumentation
or controlled OTel processors. They may carry model input/output, tool IO,
provider response fragments or SDK-native span details when the deployment
explicitly enables that sink behavior.

Rules:

- raw or near-raw LLM IO must stay inside external observability/eval sinks;
  app-api, Operator Console, Temporal metadata and repo-owned run/step
  projection consume only safe summaries and deep links.
- masking/redaction is configured at the SDK, OTel processor, Collector or sink
  adapter boundary; it is not simulated by app-api.
- secrets, credentials, auth headers, cookies, JWTs, database URLs,
  object-store credentials and raw Hindsight refs are never allowed in this
  lane.
- LLM debug traces may help diagnose prompt/tool/model/provider behavior, but
  cannot define run lifecycle, terminal state, retry/cancel truth or release
  verdicts.

## Score Payloads

Active eval publishing writes Ragas-derived numeric Langfuse scores from
sanitized trace or dataset projections. Scores are evidence for eval review;
they are not repo-owned release verdicts.

Allowed score fields:

- `traceId`
- `observationId`
- `datasetRunId`
- `datasetItemId`
- `name`: registered `ragas.*` score name
- `value`: numeric metric value
- `dataType`: `NUMERIC`
- `source`: `API`
- `metadata.case_id`
- `metadata.eval_kind`
- `metadata.metric_key`
- `metadata.source_kind`
- `metadata.request_id`
- `metadata.case_family`
- `metadata.schema_version`
- `metadata.failure_class`

Uncorrelated Ragas results are skipped rather than guessed. Langfuse request
failures fail the publish command; they are not downgraded to warnings. SDK score
writes are flushed before the publish command returns. Score environment is
resolved by Langfuse SDK/runtime environment configuration, not by duplicating a
repo-owned score DTO field.

## Forbidden Payloads

The following values must not be exported to any Langfuse lane:

- raw memory text
- Hindsight raw bank id
- Hindsight operation id or operation ref
- Hindsight runtime document ref
- JWT, cookies or authorization headers
- API keys or provider secrets
- database URLs
- object-store secrets

The following values are forbidden in `repo_observation`, score metadata and
safe eval projections, but may exist in `llm_debug_trace` only under the
controlled sink policy above:

- raw prompt
- raw answer
- raw transcript
- standalone query text
- raw retrieved snippet
- source body text
- provider raw response
