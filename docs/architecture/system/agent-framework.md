---
doc_type: architecture
truth_scope: execution
owner_boundary: agent-runtime
status: active
created: 2026-06-13
updated: 2026-07-13
---
# Agent Framework

## Boundary

`apps/agent-runtime` owns the model-facing OpenAI Agents SDK loop. It does not
own product auth, durable lifecycle, retrieval admission, source truth or final
projection persistence.

## Runtime Shape

One Temporal Agent Activity invokes one SDK run containing:

1. the primary agent;
1. admitted model-visible function tools;
1. the official `knowledge_query` handoff;
1. the Knowledge Agent and internal `knowledge_search`;
1. one structured terminal output.

Execution-control injects the required `agent_runtime` limits from its runtime
config. Current profiles set a 90-second SDK deadline, 2,048 output tokens, six
SDK turns, three knowledge searches, 8,000 characters for the current input and
16,000 characters for prior model context. Agent-runtime applies `maxTurns`,
`maxTokens` and an abort signal; execution-control gives the HTTP transport a
small grace period while Temporal retains the outer 180-second Activity bound.

A handoff or function call is an SDK operation, not a Temporal activity or
durable replan phase.

## Model Input

`final_model_context.v2` contains prior conversation turns, session state,
bounded prior evidence/tool summaries and the completed memory recall block.
Agent-runtime converts these values to SDK `AgentInputItem[]` and appends the
current user message as the final user item. The current message is not copied
into final context, and dynamic context is not appended to developer
instructions.

Execution-control measures Unicode characters after memory and prior-result
enrichment. It deterministically drops oldest prior tool results, memory, old
turns and evidence snippets in that order while retaining evidence identity.
An oversized current input or an untrimmable context fails with
`context_budget_exceeded`.

## Agent Ownership

The primary agent makes the first semantic decision. It may answer, clarify,
refuse, call an admitted model-visible tool or hand off a knowledge question.
There is no app-api intent classifier or execution-control semantic router.

The Knowledge Agent receives the handoff state and the current query-serving
target list. It can call only `knowledge_search`. It searches one target at a
time, stops when evidence is sufficient and uses history only for an explicit
prior-version, as-of-date or comparison question. Repeating the same normalized
target/query/history tuple returns `duplicate_query` and still consumes the
configured search budget. Insufficient evidence produces
`unsupported_by_evidence`.

## Tool Admission

`configs/runtime/tools.v5.json` and
`configs/runtime/tool-function-schemas.v2.json` define runtime exposure and
strict model arguments.

- `transport_schedule_lookup` and `knowledge_query` are model-visible.
- `knowledge_query` is an SDK handoff with `{query_text}`.
- `knowledge_search` is internal-only with
  `{query_text, target, include_history}`.
- Schema or endpoint existence does not open a tool.

Execution-control supplies the request-visible tool names and the admitted
knowledge targets. The SDK cannot widen either list.

## Output And Tracing

Agent-runtime returns a structured terminal envelope, public and internal tool
call summaries, token usage, tool runtime fingerprints and trace correlation.
It propagates W3C `traceparent` and `baggage` across execution-control calls.

Terminal runtime failures use stable non-retryable codes:
`context_budget_exceeded`, `agent_deadline_exceeded`, `max_turns_exceeded`,
`provider_unavailable`, `tool_execution_failed` or `run_failed`. The same shape
is used by JSON and terminal SSE errors.

OpenAI Agents SDK spans are instrumented through OpenInference and the official
Langfuse OTel span processor. When the process has an OTLP traces exporter, the
trusted Langfuse trace includes model I/O. Requests cannot change telemetry
configuration.

Execution-control validates evidence refs and writes final projection. It does
not synthesize or rewrite the answer. PostgreSQL keeps input/output/cached token
counts but no repo-calculated model cost; Langfuse calculates cost from model
identity and usage.

## Related Documents

- `tool-routing.md`
- `agentic-retrieval.md`
- `execution-agent-layer.md`
- `../../contracts/tool-execution.md`
