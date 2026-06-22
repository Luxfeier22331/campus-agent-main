---
doc_type: contract
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-06-18
updated: 2026-06-18
---
# Langfuse Runtime Observability Contract

## Contract Boundary

This contract defines the sanitized OTel attributes that may be exported to
Langfuse. It does not define app-api public HTTP shape, Temporal history shape
or `packages/contracts` DTOs.

Eval score publishing uses the same boundary: `packages/evals` may write
sanitized score payloads to Langfuse, but Langfuse score schemas do not become
repo DTOs and must not leak into `packages/contracts`.

RAGAS score publishing must be based on repo-owned safe eval artifacts or golden
dataset execution results. Langfuse traces are not a source of raw answer,
retrieved context or reference text for RAGAS scoring.

## Trace Attributes

Every Langfuse-bound online answer trace should provide:

- `langfuse.trace.name`: `online-answer`
- `langfuse.session.id`: app-api conversation id when available
- `langfuse.user.id`: stable non-PII user identifier
- `langfuse.release`: runtime release identifier
- `langfuse.trace.tags`: surface, capability and environment tags
- `request_id`
- `run_id`
- `workflow_id`
- `trace_id`

## Observation Attributes

Every Langfuse-bound workflow/activity observation should provide:

- `step_id`
- `step_kind`
- `activity_type`
- `task_queue`
- `activity_attempt`
- `selected_capability`
- `selected_tool`
- `status`
- `duration_ms`
- `schedule_to_start_ms`
- `projection_ref`
- `fail_close_reason`

RAG observations may additionally provide safe summary counts and categorical
states. They must not include source body text or retrieved snippets.

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

## Score Payloads

`online-answer-path` profile publishing sends one boolean Langfuse score per
correlated sanitized case result.

Allowed score fields:

- `traceId`
- `name`: `<profile_id>.profile`
- `value`: `1` for pass, `0` for fail
- `dataType`: `BOOLEAN`
- `source`: `API`
- `environment`
- `metadata.profile_id`
- `metadata.case_id`
- `metadata.request_id`
- `metadata.case_family`
- `metadata.schema_version`
- `metadata.grader_version`
- `metadata.failure_class`

Uncorrelated profile results are skipped rather than guessed. Langfuse request
failures fail the publish command; they are not downgraded to warnings.

## Forbidden Payloads

The following values must not be exported to Langfuse:

- raw prompt
- raw answer
- raw transcript
- standalone query text
- raw retrieved snippet
- source body text
- provider raw response
- JWT, cookies or authorization headers
- API keys or provider secrets
- database URLs
- object-store secrets
