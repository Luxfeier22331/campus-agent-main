---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-11
---
# App API Runtime Schema

<!-- markdownlint-disable MD013 -->

## `runtime.request_execution`

Purpose:

- command-side request ledger and source for operator request projection.

Columns:

- `request_id`
- `conversation_id`
- `user_message_id`
- `assistant_message_id` nullable
- `turn_sequence`
- `surface`
- `actor_user_id`
- `actor_principal_id`
- `actor_roles_json`
- `actor_departments_json`
- `principal_type`
- `principal_label` nullable
- `entitlement_snapshot_id` nullable
- `entitlement_groups_json`
- `visibility_scope` nullable
- `applicability_scope` nullable
- `idempotency_key` nullable
- `request_fingerprint_sha256` nullable
- `trace_id`
- `run_id` nullable
- `safety_identifier` nullable
- `requested_tool` nullable
- `requested_scope` nullable
- `version_query_json` nullable
- `resolved_scope` nullable
- `selected_tool` nullable
- `status`
- `error_code` nullable
- `question_preview`
- `answer_preview` nullable
- `source_doc_ids_json` nullable
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `created_at`
- `updated_at`

Indexes:

- `(conversation_id, started_at)`
- `(conversation_id, turn_sequence)`
- `(status, started_at)`
- `(run_id, started_at)`
- `(safety_identifier, started_at)`
- unique `(actor_user_id, idempotency_key)`

Status is one of `accepted`, `completed`, `needs_clarification`,
`no_answer`, `error`, `approval_required`, `rejected` or `cancelled`.

Rules:

- app-api writes acceptance before starting durable execution and updates the
  same row from the validated finalization response;
- `run_id` links the request to execution-control's durable run;
- public chat leaves `requested_tool` and `requested_scope` empty;
- `resolved_scope`, `selected_tool`, answer preview and source ids are
  finalization facts;
- previews and source ids are bounded projections, not raw prompts, answers or
  evidence payloads;
- no request diagnostics, planner, grounding or retrieval candidate JSON is
  stored in this table.

## `runtime.projection_outbox`

Purpose:

- committed boundary from request command truth to app-api read-model
  projection.

Columns:

- `event_id`
- `request_id`
- `event_type`
- `payload_json`
- `occurred_at`
- `available_at`
- `processed_at` nullable
- `attempt_count`
- `last_error` nullable

Indexes:

- `(processed_at, available_at)`
- `(request_id, occurred_at)`

Request lifecycle event types include:

- `request.accepted`
- `request.completed`
- `request.needs_clarification`
- `request.no_answer`
- `request.error`
- `request.approval_required`
- `request.rejected`
- `request.cancelled`

Execution audit event types include:

- `execution.admission_rejected`
- `execution.cancel_requested`
- `execution.cancelled`
- `execution.activity_failed`
- `execution.timed_out`

Rules:

- projector consumption is idempotent by `event_id`;
- payloads contain only fields required by request/audit projection;
- execution audit payloads may carry bounded decision, failure, HTTP, task
  queue and timing facts;
- payloads never contain raw prompt, answer, transcript, source body, provider
  response or auth material.

## `runtime.request_observability_fact`

Purpose:

- request-scoped safe runtime index used by app-api operator queries.

Columns:

- `request_id`
- `trace_id`
- `safety_identifier` nullable
- `conversation_id`
- `surface`
- `principal_type`
- `entitlement_snapshot_id` nullable
- `policy_projection_version` nullable
- `policy_reason` nullable
- `requested_tool` nullable
- `requested_scope_summary` nullable
- `version_query_mode` nullable
- `version_query_summary` nullable
- `resolved_scope_summary` nullable
- `selected_tool` nullable
- `status`
- `error_code` nullable
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `supporting_sources_json` not null default `[]`
- `refusal_class` nullable
- `semantic_outcome` nullable
- `scope_class` nullable
- `acl_decision` nullable
- `acl_anomaly_code` nullable
- `fail_closed` nullable
- `workflow_trace_summary_json` nullable
- `stage_timing_json` not null default `{}`
- `debug_trace_refs_json` not null default `[]`
- `answer_eval_fingerprint_json` nullable
- `llm_io_fingerprint_json` nullable
- `model_provider` nullable
- `model_name` nullable
- `prompt_id` nullable
- `prompt_version` nullable
- `template_sha256` nullable
- `trace_available`
- `projection_lag_ms` nullable
- `measured_at`
- `updated_at`

Indexes:

- `(started_at)`
- `(status, started_at)`
- `(surface, started_at)`
- `(selected_tool, started_at)`
- `(principal_type, started_at)`
- `(model_name, started_at)`
- `(safety_identifier, started_at)`

Rules:

- acceptance seeds the row; finalization replaces it with validated outcome
  facts for the same `request_id`;
- model and prompt identity are derived from the validated
  `llm_io_fingerprint`, not from duplicate free-form observability fields;
- `supporting_sources_json` is derived only from top-level finalization
  `result.sources`;
- each supporting source contains canonical URL, source title, source kind,
  target kind and version id; raw snippets and retrieval candidates are not
  persisted here;
- workflow trace, stage timing and debug refs are allowlisted safe projections;
- answer-eval and LLM I/O fingerprints are verified for request/run/trace and
  hash consistency before persistence;
- `projection_lag_ms` is updated by read-model materialization;
- the table does not store usage rollups, estimated cost, candidate counts,
  retrieval adequacy, citation heuristics, grounding verdicts or app-owned
  quality badcases;
- Operator Console reads this app-owned projection and approved links; it does
  not query raw Langfuse, Sentry or OpenTelemetry payloads.
