---
doc_type: architecture
truth_scope: execution
owner_boundary: tool-runtime
status: active
created: 2026-04-21
updated: 2026-07-13
---
# Tool Runtime

## Boundary

This document owns SDK tool exposure and handler boundaries. OpenAI Agents SDK
owns the online tool loop; Temporal does not dispatch one activity per tool.

## Registry Truth

`configs/runtime/tools.v5.json` defines tool name, exposure, payload/result
schemas, handler, timeout and bounded projection policy. Strict function
arguments live in `configs/runtime/tool-function-schemas.v2.json`.

- `model_visible` entries are available to the primary agent when admitted for
  the run.
- `internal_only` entries are available only to their owning specialist.
- A contract, endpoint or implementation does not make a tool visible.

Current model-visible tools are `transport_schedule_lookup` and
`knowledge_query`. `knowledge_search` is internal-only.

## Handler Types

`execution_control_internal_query` calls an authenticated execution-control
read-model endpoint inside the SDK run. The endpoint validates run identity,
policy and result shape before returning bounded JSON.

`agent_handoff` maps a model-visible capability to an official SDK handoff.
`knowledge_query` targets `knowledge_agent`; it is not an HTTP acknowledgement
for later Go execution.

## Knowledge Tools

The handoff payload is `{query_text}`. The Knowledge Agent receives the active
target list from execution-control and may call internal `knowledge_search`
with `{query_text, target, include_history}` within the configured search
budget. Current runtime profiles allow three calls. Identical normalized
target/query/history calls return `duplicate_query` and still consume a slot.

Corpus, collection, alias, top-k, provider and vector-store controls stay
server-owned. The search result contains an outcome, target, safe result ref,
counts, retriever modes and bounded evidence. It never exposes raw Qdrant or
provider payloads.

## Projection

`tool_trajectory.v2` separates public `tool_calls` from
`internal_tool_calls`. Safe projection may include tool identity, argument
shape/hash, eval-safe arguments, invocation id, search ordinal, status, result
kind, counts, provider/model identity and duration.

Raw model arguments, source bodies, credentials and backend responses are
forbidden.

## Related Documents

- `agent-framework.md`
- `tool-routing.md`
- `agentic-retrieval.md`
- `../../contracts/tool-trajectory.md`
