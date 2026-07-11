---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-agent-layer
status: active
created: 2026-04-21
updated: 2026-07-11
---
# Execution Agent Layer Architecture

## Boundary

Execution Agent Layer is the durable governance boundary implemented by
`apps/execution-control` and Temporal. It is not a second agent framework and
does not own semantic tool routing.

OpenAI Agents SDK in `apps/agent-runtime` is the only online agent/tool loop
owner.

## Canonical Flow

```text
app-api authenticated request
-> execution-control run admission
-> Temporal ToolExecutionWorkflow
-> Memory Recall
-> one Agent Activity containing the complete SDK run
-> Finalization
-> Memory Append
-> sanitized projection
-> app-api persistence / stream
```

The Agent Activity includes primary-agent reasoning, model-visible function
tools, official handoff to the Knowledge Agent, internal `knowledge_search`
calls and structured terminal output.

## Execution-Control Ownership

Execution-control owns:

- run admission and identity consistency;
- request-scoped visible tool and knowledge-scope projection;
- Temporal start, query, cancel, timeout and retry policy;
- memory recall and append activities;
- internal query authentication and admission;
- scope/version enforcement for `knowledge_search`;
- embedding, Qdrant lookup, optional rerank and bounded evidence projection;
- terminal evidence validation, source generation and finalization write;
- sanitized run/event/step/result projection and runtime observability.

Execution-control does not own:

- the primary or Knowledge Agent semantic loop;
- SDK function-tool selection;
- answer synthesis or answer rewriting;
- a knowledge-specific worker or queue;
- a fixed retrieval, grounding or replanning graph;
- product auth, conversation truth or browser transport.

## Worker Boundary

The online execution plane has only three worker pools:

- `workflow-worker` for deterministic workflow execution;
- `activity-worker-core` for Memory Recall, Finalization and Memory Append;
- `activity-worker-agent` for one complete OpenAI Agents SDK run.

SDK handoffs and function-tool calls remain inside the Agent Activity. They do
not create additional Temporal queues or worker identities.

## Finalization

Finalization consumes the agent terminal result and projected internal-tool
evidence. For evidence-backed answers it verifies that every evidence reference
belongs to an admitted `knowledge_search` result and derives browser-safe source
items.

Finalization may reject malformed or unsupported output. It must not call a
model, add unsupported claims, paraphrase the answer or silently drop required
sources. App-api stores and streams the finalized answer and sources as written.

## Fail-Closed Rules

The run fails closed when tool exposure, scope/version admission, internal query
auth, evidence identity, terminal schema or projection truth is missing or
invalid. Cancellation and timeout propagate through the Agent Activity and
internal provider calls. No fallback answer path is admitted.

## Related Documents

- `agent-framework.md`
- `durable-runtime.md`
- `tool-runtime.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
