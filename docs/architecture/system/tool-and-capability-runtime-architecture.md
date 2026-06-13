---
doc_type: architecture
truth_scope: capability
owner_boundary: execution-control-and-capability-packages
status: active
created: 2026-06-13
updated: 2026-06-13
---
# Tool And Capability Runtime Architecture

## Document Boundary

This document owns the supporting architecture for typed tools, deterministic
capabilities, explicit agent-as-tool steps, `CapabilitySpec`, `ToolSpec` and
cross-step bounded context projection.

It does not own:

- product surface admission
- Temporal object model or worker pool mechanics
- model-facing SDK runtime internals
- capability-local source truth schemas
- RAG-family internal retrieval planning

## Core Shape

Domain capability defaults to tools-first:

```text
Execution Agent Layer
-> admitted typed tool or bounded agent-as-tool step
-> projection-backed internal query service / retrieval graph
-> StepResult or StepOutputProjection
-> finalization or next admitted step
```

Typed tools own deterministic read-only data access. Agent-as-tool owns bounded
semantic work inside a stable capability boundary, such as disambiguation,
summary, cross-tool reasoning, clarification or answer shaping.

## Tool Classes

- Capability-facing tool: user-intent-level read-only capability such as notice
  discovery, transport schedule lookup, service status lookup or knowledge
  query signal.
- Deterministic query function: internal read-model function such as resolving a
  selected notice ref, reading a source card or fetching bounded context.
- Capability-internal function: admitted internal function used inside one
  capability boundary; it is not automatically model-visible to the primary
  agent.
- Explicit agent-as-tool: semantic specialist step admitted by workflow and
  constrained by a capability-specific tool subset and projection contract.

Having a JSON schema is not sufficient for something to become a model-visible
tool.

## Registry Artifacts

`CapabilitySpec` defines capability boundary, input and output projection,
allowed tools, context filter, opening gate, timeout / budget, trace projection
and eval denominator.

`ToolSpec` / `tool-catalog.v1` defines model-visible tools and controlled
function surfaces. Provider or SDK function schemas must be generated from, or
checked against, repo-owned artifacts.

The registries must support:

- Go runtime policy allowlist checks
- deterministic structured planner target / payload-kind admission
- model-facing function schema generation
- sanitized workflow trace / execution audit projection
- eval denominators for tool selection, argument precision and fail-close

## Context Projection

Cross-step data must flow through bounded typed artifacts, not raw prompt text.
Examples include schedule baselines, notice change sets, canonical notice
context, place context, service guide facts, evidence bundles and grounding
verdicts.

Every projection consumed by a later step must carry kind, source step, source
refs, visibility posture, hash, length budget and safety summary. Missing or
visibility-incompatible projections fail closed or trigger clarification; they
must not fall back to raw transcript, raw evidence dump, raw OCR or raw provider
trace.

## Opening Gate

A capability may be executable but still not product-open. Product opening
requires an explicit typed contract, source-truth owner, projection policy,
fail-close outcome, timeout / cancel behavior and operator/eval denominator for
that capability boundary.

Readiness of one capability does not define main-chain completion. Closed or
candidate-only capabilities must fail closed rather than masquerade as generic
knowledge answers.

## Forbidden Shapes

- Do not wrap deterministic data reads in agent names without semantic
  responsibility.
- Do not let provider parallel tool calls decide cross-capability fanout unless
  ToolSpec, runtime posture, eval denominator and merge policy explicitly allow
  it.
- Do not expose raw SQL, object-store bytes, OCR dumps, collector runtime or
  ingestion build paths as query-time tools.
- Do not pass canonical notice body, OCR owner text or attachments as public
  function output.
- Do not use a tool catalog as an authorization or source-truth owner.

## Related Documents

- `execution-agent-layer-architecture.md`
- `agent-framework-boundary-architecture.md`
- `capability-routing-and-admission-architecture.md`
- `agentic-retrieval-architecture.md`
- `../../contracts/README.md`
