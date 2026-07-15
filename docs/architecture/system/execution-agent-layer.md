---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-agent-layer
status: active
created: 2026-04-21
updated: 2026-07-13
---
# Execution Agent Layer

## Boundary

`apps/execution-control` and Temporal own durable execution and deterministic
governance. They are not a second agent framework and do not classify user
intent or synthesize answers.

## Canonical Flow

```text
app-api authenticated request
-> execution-control admission
-> Temporal ToolExecutionWorkflow
-> Memory Recall
-> one Agent Activity containing the complete SDK run
-> Finalization
-> Memory Append
-> sanitized projection
-> app-api persistence and stream
```

The Agent Activity contains primary-agent reasoning, SDK function tools, the
Knowledge Agent handoff, internal searches and terminal output.

## Execution-Control Ownership

Execution-control owns:

- run identity, admission, cancellation, timeout and retry;
- agent deadline, SDK turn/output, knowledge-search and context character limits;
- request-visible tool projection;
- query-serving target loading and injection;
- retrieval access enforcement and internal query authentication;
- target resolution, embedding, Qdrant hybrid lookup and bounded evidence;
- terminal evidence validation, source generation and finalization;
- sanitized run, event, step, result and OTel projection.

The Agent Activity projection stores model identity and token usage. Model cost
is calculated in Langfuse rather than duplicated in PostgreSQL or Go telemetry.

It does not own SDK tool selection, a knowledge planner, answer generation or a
knowledge-specific worker queue.

## Worker Boundary

The online plane has three worker pools:

- `workflow-worker` for deterministic workflow execution;
- `activity-worker-core` for memory and finalization activities;
- `activity-worker-agent` for the complete SDK run.

SDK handoffs and tool calls remain inside `activity-worker-agent`.

## Finalization

Finalization validates the terminal schema and resolves every evidence ref
against completed `knowledge_search` projections from the same run. It derives
browser-safe source items and `resolved_targets[]`. Forged, missing or
cross-target evidence fails the run.

Finalization must not call a model, paraphrase the answer or silently remove a
required source. App-api persists and streams the finalized result unchanged.

## Related Documents

- `agent-framework.md`
- `durable-runtime.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
