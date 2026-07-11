---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0048
status: accepted
created: 2026-06-06
updated: 2026-07-11
supersedes:
  - adr-0047-run-centric-durable-agent-runtime.md
---
# ADR-0048 Temporal Execution Plane

## Status

Accepted.

## Context

Online answers must survive browser disconnects, support cancellation and
timeouts, and expose durable product-safe projection without making PostgreSQL
rows or an HTTP request the execution scheduler.

The model-facing runtime also needs one coherent agent/tool loop. Durable
execution must wrap that loop without duplicating its semantic routing.

## Decision

Temporal is the canonical online workflow substrate. PostgreSQL stores
sanitized run/event/step/result projection; it is not workflow history or queue
truth.

`ToolExecutionWorkflow` has exactly four phases:

1. Memory Recall;
1. one Agent Activity;
1. Finalization;
1. Memory Append.

The Agent Activity invokes `apps/agent-runtime` once. One OpenAI Agents SDK run
contains the primary agent, model-visible function tools, official
`handoff()` to the Knowledge Agent, internal `knowledge_search` calls and the
structured terminal output.

Temporal does not expand SDK handoffs or function-tool calls into additional
activities. Only these worker pools exist:

- `workflow-worker`;
- `activity-worker-core`;
- `activity-worker-agent`.

Execution-control owns run admission, Temporal command/query/cancel, visible
tool and scope/version admission, internal query, bounded evidence projection,
terminal evidence/source validation and finalization projection.

OpenAI Agents SDK owns all semantic tool selection, handoff and answer
generation. Finalization does not call a model or rewrite answer text. App-api
does not rewrite the finalized answer.

Cancellation and timeout must propagate from Temporal through the Agent
Activity and in-flight internal/provider calls. Late completion cannot replace
an already terminal run.

## Consequences

- Browser streaming is a subscription to durable sanitized events.
- Workflow/core/agent queues can be scaled independently without changing
  semantic ownership.
- SDK `maxTurns` is an in-run turn budget and does not add workflow phases.
- SDK tool calls may be projected as diagnostic trajectory facts, but do not
  become a separate workflow graph.
- Missing Temporal, provider, internal query, scope or evidence truth fails
  closed.
- Online indexed knowledge has no live web-search fallback.

## Alternatives Considered

### PostgreSQL Queue

Rejected as canonical execution truth because it duplicates workflow retry,
timer, heartbeat and cancellation semantics.

### One Activity Per Tool Or Specialist

Rejected because it splits the SDK loop and creates multiple semantic owners.

### Synchronous HTTP Lifetime

Rejected because browser connection lifetime cannot own an answer run.

## Related Documents

- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/agent-framework.md`
- `docs/contracts/durable-runtime.md`
