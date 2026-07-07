---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-13
updated: 2026-06-13
---
# Execution Agent Layer Architecture

## Document Boundary

This document owns the supporting architecture for the Execution Agent Layer.
It explains the repo-owned execution governance layer that sits between
`app-api`, Temporal and model-facing tool runtimes.

It does not own:

- product surfaces or browser runtime ownership
- Temporal object schema, task queues or cancel/resume mechanics
- model-facing SDK internals
- typed tool / ToolSpec details
- RAG-family retrieval planning internals
- prompt template wording

## Core Shape

The main answer chain is:

```text
app-api
-> execution-control durable run admission
-> ToolExecutionWorkflow
-> optional context.memory_recall
-> agent.primary first model-facing decision
-> direct/no-tool terminal or admitted tool / workflow signal
-> typed tool / RAG graph when tools are needed
-> finalization.write
-> sanitized run / event / step / attempt / result projection
```

The Execution Agent Layer is not a hidden mega-agent. It is the repo-owned
governance layer inside `execution-control` that creates and advances a durable
run under explicit policy, budget, projection and fail-close rules.

## Responsibilities

Execution Agent Layer owns:

- durable run admission after product-surface admission
- visible tool set trimming before model-facing execution
- first-decision framing for `agent.primary`
- direct/no-tool terminal semantics for product identity, greetings,
  clarification, rejection, unsupported and fail-close outcomes
- selected tool / workflow-signal projection when a campus tool is needed
- deterministic workflow planning and typed step admission after first decision
- handoff shaping, bounded context projection and finalization ownership
- fail-close terminal semantics for policy, contract, admission and runtime
  failures

Execution Agent Layer does not own:

- product auth, session, account, conversation or browser route truth
- source truth, ingestion, index build, raw object storage or collection release
- provider raw trace, SDK-native graph state or SDK session memory as durable
  execution truth
- tool-local source-channel readiness
- Operator Console query ownership

## Boundary With Runtime Components

- `apps/app-api` owns product ingress, session, request ledger and surface
  tool policy.
- `apps/execution-control` owns durable execution admission, Temporal command /
  query / cancel, visible set trimming, step admission, finalization and
  sanitized projection.
- `ToolExecutionWorkflow` owns deterministic execution lifetime and step
  ordering, but it is not an agent identity.
- `apps/agent-runtime` owns the model-facing primary agent loop inside an
  admitted Temporal activity, not durable run truth.
- Tool activity workers own typed tool or bounded agent-as-tool activity execution
  after workflow admission.

## First Decision

The first model-facing decision is performed by `agent.primary` over a
workflow-trimmed visible tool set.

Missing `requested_tool` is treated only as an absent caller hint.
It must not be silently rewritten to `knowledge`. The model may answer directly
without tools when the request is product identity, ordinary chat,
clarification, rejection or out-of-scope handling.

Synthetic branches such as `assistant_intro`, `product_meta`, `product persona`
or `surface prompt profile` are not separate runtime surfaces or tools.

## Finalization

Execution Agent Layer keeps finalization ownership. Even when a typed tool,
RAG graph or bounded agent-as-tool step contributes the result, the final answer
must pass through repo-owned finalization and sanitized projection.

Specialist handoff is only valid when an admitted workflow explicitly transfers
next-response ownership with an admitted target, tool subset, context filter and
eval denominator.

## Forbidden Shapes

- Do not restore a Python bridge, bootstrap router or retrieval tool adapter as
  the online top-level orchestrator.
- Do not let provider/SDK traces replace repo-owned run and step projection.
- Do not confuse controlled SDK/provider debug traces with product/operator
  projection. They may support LLM debugging and eval, but they do not own
  lifecycle, cancel/retry, terminal reason or finalization truth.
- Do not expose all tools to the model and ask it to infer policy.
- Do not route ordinary chat to `knowledge` before the primary agent decision.
- Do not use operator diagnostics, eval readiness or release_evidence to define
  main-chain completion.

## Related Documents

- `durable-runtime.md`
- `tool-routing.md`
- `tool-runtime.md`
- `agent-framework.md`
- `ops-observability.md`
