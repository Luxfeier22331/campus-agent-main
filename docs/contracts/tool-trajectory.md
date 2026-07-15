---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-07-03
updated: 2026-07-12
---
# Tool Trajectory

## Boundary

`tool_trajectory.v2` is the sanitized tool-decision projection consumed by
operator diagnostics and eval. It is not a Langfuse DTO, browser contract,
Temporal history shape or provider response.

## Top-Level Shape

A projection contains:

- `schema_version=tool_trajectory.v2`;
- request, run and trace identity;
- optional conversation, surface, environment and release identity;
- `available_tools`;
- `decision_kind=direct_answer|tool_call|fail_closed`;
- selected tool or fail-close reason when applicable;
- public `tool_calls[]`;
- internal `internal_tool_calls[]`.

The projection is derived from the sanitized run/step/result spine. It never
requires raw prompt, provider response, source body or Temporal history replay.

## Public Tool Calls

`tool_calls[]` records primary-agent-visible function calls and handoffs. A
knowledge handoff appears as `knowledge_query` with result kind
`agent_handoff`; internal searches do not appear in this list.

A call may carry tool call id, tool name, status, result kind, duration,
argument shape/hash, fail-close reason and safe provider/model identity.

## Internal Search Calls

`internal_tool_calls[]` records Knowledge Agent `knowledge_search` calls in
ordinal order. In addition to the common call fields, each search carries:

- positive `search_ordinal`;
- eval-safe `{target, include_history}` arguments;
- optional query hash;
- outcome;
- candidate and discarded counts.

The search query text and evidence snippets are not trajectory fields. RAG text
needed by an admitted eval comes from `agent_runtime_eval_projection.v2`.

## Decision Semantics

`direct_answer` means no model-visible tool was selected. `tool_call` means an
admitted SDK function tool or handoff ran. `fail_closed` means a required
contract, configuration, policy or execution condition rejected the run.

Clarification, refusal and ordinary direct answers are not synthetic tools.

## Forbidden Data

Trajectory projection must reject, not sanitize after the fact:

- raw prompt, transcript, provider response or model output;
- raw tool arguments, retrieval query or source body;
- raw memory content or Hindsight identifiers;
- credentials, auth headers, cookies, database URLs or object-store locations.

## Eval Consumption

`packages/eval-langfuse` parses only v2. It uses public calls for primary tool
selection and the internal search sequence for Ragas official tool-call metrics
and target/history diagnostics. Answer and retrieval quality remain separate
Ragas metrics over the execution eval projection.
