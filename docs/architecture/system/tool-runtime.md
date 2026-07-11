---
doc_type: architecture
truth_scope: execution
owner_boundary: tool-runtime
status: active
created: 2026-04-21
updated: 2026-07-11
---
# Tool Runtime Architecture

## Boundary

This document owns SDK function-tool exposure and execution boundaries. OpenAI
Agents SDK is the only online tool-loop owner. Temporal does not dispatch one
activity per SDK tool call.

## Registry Truth

`configs/runtime/tools.v4.json` is the canonical runtime tool registry. Every
entry defines a stable name, exposure, strict payload/result schemas, handler,
timeout and bounded result projection policy.

Exposure is closed:

- `model_visible` tools are supplied to the primary agent;
- `internal_only` tools are supplied only to their admitted specialist;
- a schema, endpoint or implementation does not make a tool visible.

The current model-visible tools are `transport_schedule_lookup` and
`knowledge_query`. `knowledge_search` is internal-only.

## Handler Types

### Internal Query

`execution_control_internal_query` invokes an authenticated execution-control
endpoint from inside the SDK run. The owning endpoint validates run identity,
policy and result shape before returning bounded JSON.

### Agent Handoff

`agent_handoff` maps a model-visible capability to an official OpenAI Agents SDK
handoff. `knowledge_query` targets `knowledge_agent`; it is not an HTTP tool and
does not acknowledge a handoff for Go to execute later.

## Knowledge Tools

The primary agent may select `knowledge_query`. The SDK then calls
`handoff()` and transfers control to the Knowledge Agent in the same run.

The Knowledge Agent can call only `knowledge_search`. That internal tool sends
the admitted query, scope, version query and run-bound identity to
execution-control. It never exposes corpus, collection, top-k, Qdrant or
provider configuration to the primary agent or browser.

Execution-control returns bounded evidence, resolved scope/version and a safe
result reference. The Knowledge Agent uses that result to produce the terminal
answer and evidence references.

## Projection

SDK tool calls may be projected as sanitized trajectory facts: tool name, safe
argument shape/hash, invocation id, status, result kind/ref, latency and bounded
source summary. Raw arguments, provider responses and source bodies are not
canonical projection truth.

Tool-call projection is diagnostic evidence, not a second execution graph.

## Forbidden Shapes

- Go or Temporal owned tool-selection loop
- per-tool or per-specialist Temporal worker queues
- handoff acknowledgement followed by out-of-band semantic execution
- raw retrieval endpoint as a model-visible tool
- provider-native web search, remote MCP or live web fallback
- tool result that bypasses final evidence/source validation
- app-api answer rewriting after finalization

## Related Documents

- `agent-framework.md`
- `tool-routing.md`
- `execution-agent-layer.md`
- `../../contracts/tool-execution.md`
- `../../contracts/tool-trajectory.md`
