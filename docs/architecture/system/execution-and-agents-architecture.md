---
doc_type: architecture
truth_scope: execution
owner_boundary: docs
status: active
created: 2026-04-02
updated: 2026-06-13
---
# Execution And Agents Architecture

## Document Boundary

This document is a compatibility entry for historical links. After Phase 4, it
no longer owns execution, agent framework, tool / capability or RAG body truth.

It answers only: which owner-specific system architecture document should be
read instead.

## Owner Routes

- Execution Agent Layer, main answer chain semantics, first decision and
  finalization ownership:
  `execution-agent-layer-architecture.md`
- Temporal, durable run / event / step / attempt / result projection, cancel,
  timeout, resume, worker pools and autoscaler boundary:
  `durable-agent-runtime-architecture.md`
- Typed tools, deterministic query functions, agent-as-tool, ToolSpec /
  CapabilitySpec, context projection and opening gate:
  `tool-and-capability-runtime-architecture.md`
- OpenAI Agents SDK, `apps/agent-runtime`, model-facing function tool loop and
  SDK trace boundary:
  `agent-framework-boundary-architecture.md`
- Surface admission, primary agent first-decision routing, visible tool set and
  clarification split:
  `capability-routing-and-admission-architecture.md`
- RAG-family retrieval planning, evidence selection, grounding and internal
  retrieval roles:
  `agentic-retrieval-architecture.md`
- Prompt / instruction ownership and provider-facing prompt assembly:
  `prompt-and-instruction-architecture.md`
- Retired Python / offline capability boundary:
  `python-capability-boundaries.md`

## Stable Summary

The accepted long-term shape remains Execution Agent Layer-led, durable,
capability-neutral and tools-first:

```text
app-api
-> execution-control
-> Temporal / CapabilityExecutionWorkflow
-> optional context.memory_recall
-> agent.primary SDK loop
-> direct/no-tool terminal or admitted tool / workflow signal
-> typed tool / RAG graph
-> finalization.write
-> sanitized projection
```

Key invariants:

- `Campus Assistant` is the product-level experience, not a process.
- `Execution Agent Layer` is the repo-owned durable governance layer.
- `CapabilityExecutionWorkflow` is a Temporal workflow, not an agent identity.
- `apps/agent-runtime` is model-facing substrate, not orchestration truth.
- Typed tools are the default for deterministic read-only capability access.
- Explicit agent-as-tool is reserved for bounded semantic specialist work.
- RAG belongs inside the `knowledge` family and retrieval owner documents.

## Forbidden Shapes

- Do not restore retired Python bridge, bootstrap router or flat retrieval
  tool-adapter as the online answer orchestrator.
- Do not make this file the owner for ToolSpec, CapabilitySpec, SDK, RAG,
  prompt, Temporal or operator evidence details.
- Do not use staging/release proof, operator panel readiness or capability
  content maturity to define main-chain architecture completion.
- Do not route ordinary chat to `knowledge` before the primary agent decision.

## Related Documents

- `execution-agent-layer-architecture.md`
- `tool-and-capability-runtime-architecture.md`
- `agent-framework-boundary-architecture.md`
- `durable-agent-runtime-architecture.md`
- `capability-routing-and-admission-architecture.md`
- `agentic-retrieval-architecture.md`
- `prompt-and-instruction-architecture.md`
- `python-capability-boundaries.md`
