---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-07-03
updated: 2026-07-03
---
# Tool Trajectory Contract

## Contract Boundary

This document owns `tool_trajectory.v1`, the sanitized trajectory projection
used by operator diagnostics and agent tool-use eval.

It complements but does not replace:

- `tool-execution.md`, which owns the app-api -> execution-control run
  command/query wire contract
- `tool-read-model.md`, which owns internal typed tool read-model seams
- `langfuse-runtime.md`, which owns Langfuse-bound OTel attribute and score
  payload limits
- `../reference/eval.md`, which owns active eval lanes and score names

`tool_trajectory.v1` is not a Langfuse DTO, browser API, Temporal history shape
or provider response schema. Langfuse, Operator Console and local eval runners
may consume this projection, but they do not own it.

## Projection Semantics

`tool_trajectory.v1` records the safe facts needed to answer:

- which tools were available to the primary agent
- whether the request ended as direct answer, tool call or fail-closed outcome
- which tool was selected when a tool was selected
- whether tool arguments matched the admitted schema
- whether tool execution produced a valid result contract or a diagnosable
  fail-closed state
- which provider/model/search transport participated when that fact is safe
  and useful for evaluation
- which bounded source categories were returned for source-policy checks

It is a projection over the canonical diagnostic spine:

`Run -> RunEvent -> RunStep -> StepAttempt -> StepResult -> Finalization`

The projection may be rebuilt from step trajectory and sanitized observation
metadata. It must not require raw prompt, raw provider response, raw source
body or Temporal history replay.

## Required Field Families

A valid `tool_trajectory.v1` projection must carry these field families when
the owning runtime has the underlying fact:

- schema identity:
  - `schema_version`: `tool_trajectory.v1`
- request identity:
  - `request_id`
  - `run_id`
  - `trace_id`
  - `conversation_id` when available
  - `workflow_id` when available
- execution context:
  - `surface`
  - `environment`
  - `release` when available
- tool decision:
  - `available_tools`
  - `decision_kind`: `direct_answer`, `tool_call` or `fail_closed`
  - `selected_tool` when `decision_kind=tool_call`
  - `fail_close_reason` when `decision_kind=fail_closed`
- tool call summary when a tool was called:
  - `tool_name`
  - `tool_call_id` or equivalent stable step/call identifier
  - `arguments_shape`
  - `arguments_hash`
  - `status`
  - `duration_ms`
  - `result_kind`
  - `fail_close_reason` when the tool failed closed
- provider summary when a model/provider participated:
  - `provider`
  - `transport`
  - `model`
  - `provider_profile_id`
- source/evidence summary when a tool returns bounded evidence:
  - `source_count`
  - `source_kinds`
  - `source_policy`

The projection may omit an optional field only when the underlying fact is not
available or the runtime branch does not produce it. It must not invent values
to make an eval case pass.

## Decision Kinds

`direct_answer` means the primary agent completed without calling a
model-visible tool.

`tool_call` means an admitted model-visible tool or workflow signal was
selected and projected into durable execution.

`fail_closed` means the request was rejected, blocked or stopped because a
required contract, configuration, policy, tool readiness or evidence condition
was missing.

Synthetic tools must not be created for greetings, product self-introduction,
clarification, rejection or ordinary direct answers.

## Argument Projection

Tool arguments are never exported as raw model text.

`arguments_shape` records only schema-level presence and categorical validation
state needed by deterministic scoring. `arguments_hash` records a stable hash
of the canonical sanitized argument object when correlation is needed.

Argument validation failures must be represented as diagnosable fail-closed
trajectory facts. They must not be repaired by the eval runner, Langfuse
publisher or browser projection.

## Source Projection

Source summaries are tool-specific but must remain bounded and sanitized.

For `public_web_search`, source projection may include source count, source
kinds and source-policy categories such as public HTTPS MUC official-web
validity. It must not include raw provider response, full page text,
unrestricted snippets or provider-local ranking payload.

For RAG-related branches, source summaries must follow the Ragas-safe
projection boundary in `langfuse-runtime.md` and the owning retrieval / evidence
contracts.

## Forbidden Fields

`tool_trajectory.v1` must not contain:

- raw prompt
- raw transcript
- standalone unsanitized user query text
- provider raw response
- raw tool arguments
- raw retrieved snippet
- raw source body or page body
- raw memory text
- Hindsight raw bank id, operation id, operation ref or runtime document ref
- JWT, cookies or authorization headers
- API keys or provider secrets
- database URLs
- object-store URLs or secrets

If a downstream sink needs richer inspection, it must link back through safe
correlation identifiers to the owning runtime or external platform with the
proper access controls. It must not widen this projection.

## Eval Consumption

Agent tool-use eval consumes `tool_trajectory.v1` through
`packages/eval-langfuse`.

Deterministic tool-use scorers may evaluate:

- expected decision kind
- expected selected tool
- tool argument validity
- result contract validity
- expected fail-closed behavior
- tool-specific source-policy checks
- latency as a numeric diagnostic signal

Tool-use eval must not score answer prose, primary model selection or RAGAS
answer/evidence quality. RAGAS remains a separate RAG scoring lane.
