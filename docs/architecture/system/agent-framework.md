---
doc_type: architecture
truth_scope: execution
owner_boundary: agent-runtime
status: active
created: 2026-06-13
updated: 2026-07-11
---
# Agent Framework Boundary Architecture

## Boundary

This document owns the model-facing agent framework boundary for the online
answer path. OpenAI Agents SDK is the only online agent and tool-loop owner.

It does not own product auth, durable run truth, Temporal lifecycle, source
truth, query-serving admission, canonical projection or browser transport.

## Runtime Shape

One Temporal Agent Activity invokes `apps/agent-runtime` once. That single SDK
run contains:

1. the primary agent;
1. model-visible SDK function tools;
1. the official `handoff()` from the primary agent to the Knowledge Agent;
1. the Knowledge Agent and its internal-only `knowledge_search` tool;
1. one structured terminal output.

The SDK run is not expanded into separate Temporal activities for handoffs or
tool calls. SDK `maxTurns` is a turn budget for this run, not a Temporal replan
contract.

## Agent Ownership

The primary agent owns the first semantic decision. It may answer directly,
clarify, refuse, call an admitted model-visible tool or hand off to the
Knowledge Agent.

The Knowledge Agent owns governed knowledge reasoning, use of bounded evidence
and evidence-backed structured output. It can call only `knowledge_search`.
It cannot call transport tools, public web search, provider-native web tools,
remote MCP or ingestion services.

## Tool Admission

`configs/runtime/tools.v4.json` and the matching strict function schemas define
tool exposure:

- `model_visible` tools are available to the primary agent;
- `knowledge_query` is represented as an SDK handoff to `knowledge_agent`;
- `knowledge_search` is `internal_only` and available only to the Knowledge
  Agent;
- schema existence alone never opens a tool.

Execution-control supplies the request-scoped visible tool set and allowed
knowledge scopes. The SDK cannot widen either set.

## Internal Query Boundary

SDK tools call repo-owned execution-control internal query endpoints. For
`knowledge_search`, execution-control owns scope/version admission, provider
config resolution for embedding/rerank, Qdrant lookup, bounded evidence shaping
and sanitized tool-result projection.

The retrieval backend does not synthesize an answer. The Knowledge Agent
consumes the bounded result and produces the terminal answer.

## Output Boundary

Agent-runtime returns structured terminal output, SDK tool-call summaries,
usage and safe trace references. It does not return raw prompts, raw provider
payloads, raw source bodies or unrestricted evidence text.

Execution-control finalization validates evidence references against projected
`knowledge_search` results, generates browser-safe sources and writes the
terminal projection. It does not call a model or rewrite answer text. App-api
persists and streams that finalized answer and sources without rewriting them.

## Failure Semantics

Missing provider config, invalid tool exposure, unadmitted scope/version,
malformed terminal output, forged evidence references, timeout or cancellation
fails closed. There is no fallback agent loop, live web-search fallback or
second synthesis path.

## Related Documents

- `execution-agent-layer.md`
- `tool-runtime.md`
- `tool-routing.md`
- `durable-runtime.md`
- `retrieval-serving.md`
