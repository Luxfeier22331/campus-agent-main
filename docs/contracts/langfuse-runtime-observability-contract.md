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

## Forbidden Payloads

The following values must not be exported to Langfuse:

- raw prompt
- raw answer
- raw transcript
- raw retrieved snippet
- source body text
- provider raw response
- JWT, cookies or authorization headers
- API keys or provider secrets
- database URLs
- object-store secrets
