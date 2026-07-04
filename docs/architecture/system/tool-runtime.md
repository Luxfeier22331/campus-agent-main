---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control-and-tool-packages
status: active
created: 2026-06-13
updated: 2026-06-27
---
# Tool Runtime Architecture

## Document Boundary

This document owns the supporting architecture for typed tools, deterministic
tool execution, explicit agent-as-tool steps, `ToolSpec` and cross-step bounded
context projection.

It does not own:

- product surface admission
- Temporal object model or worker pool mechanics
- model-facing SDK runtime internals
- domain-local source truth schemas
- RAG-family internal retrieval planning

## Core Shape

Domain execution defaults to tools-first:

```text
Execution Agent Layer
-> admitted typed tool or bounded agent-as-tool step
-> projection-backed internal query service / retrieval graph
-> StepResult or StepOutputProjection
-> finalization or next admitted step
```

Typed tools own deterministic read-only data access. Agent-as-tool owns bounded
semantic work behind an explicit tool/workflow boundary, such as disambiguation,
summary, cross-tool reasoning, clarification or answer shaping.

## Tool Classes

- User-facing tool: user-intent-level read-only tool such as notice
  discovery, transport schedule lookup or knowledge query signal.
- Deterministic query function: internal read-model function such as resolving a
  selected notice ref, reading a source card or fetching bounded context.
- Tool-internal function: admitted internal function used inside one
  tool/workflow boundary; it is not automatically model-visible to the primary
  agent.
- Explicit agent-as-tool: semantic specialist step admitted by workflow and
  constrained by a tool-specific subset and projection contract.

Having a JSON schema is not sufficient for something to become a model-visible
tool.

## Concept Governance

`tool` is the durable product/runtime concept for deterministic campus
abilities. New docs, configs, package names and schemas should use concrete
tool ids, `typed tool` or `agent-as-tool`; they should not introduce broader
taxonomy names as active architecture.

Rules:

- Retired capability taxonomy, family taxonomy and deployment-role labels are
  retired or implementation-scoped. They may appear only in historical or
  migration context.
- Internal query functions and tool-internal functions are not model-visible
  unless admitted by the tool registry and opened by the runtime profile.
- Worker command names, Temporal task queues and deployment roles do not create
  product-facing tool taxonomy.
- Tool names must follow the repo-owned registry and concrete tool id, not a
  model/provider-local function name.

## Registry Artifacts

`ToolSpec` defines tool boundary, input and output projection, opening gate,
timeout / budget, trace projection and eval denominator.

`ToolSpec` / `tools.v4` defines model-visible tools and controlled
function surfaces. Provider or SDK function schemas must be generated from, or
checked against, repo-owned artifacts. Tool payload/result schema references
must point to registered JSON Schema definitions, not language-local Python,
Go or TypeScript model names.

The registries must support:

- Go runtime policy allowlist checks
- deterministic structured planner target / payload-kind admission
- model-facing function schema generation
- sanitized workflow trace / execution audit projection
- eval denominators for tool selection, argument precision and fail-close

## Context Projection

Cross-step data must flow through bounded typed artifacts, not raw prompt text.
Examples include schedule baselines, notice change sets, canonical notice
context, place context, evidence bundles and grounding verdicts.

Every projection consumed by a later step must carry kind, source step, source
refs, visibility posture, hash, length budget and safety summary. Missing or
visibility-incompatible projections fail closed or trigger clarification; they
must not fall back to raw transcript, raw evidence dump, raw OCR or raw provider
trace.

## Opening Gate

A tool may be executable but still not product-open. Product opening
requires an explicit typed contract, source-truth owner, projection policy,
fail-close outcome, timeout / cancel behavior and operator/eval denominator for
that tool boundary.

Readiness of one tool does not define main-chain completion. Closed or
candidate-only tools must fail closed rather than masquerade as generic
knowledge answers.

## Forbidden Shapes

- Do not wrap deterministic data reads in agent names without semantic
  responsibility.
- Do not let provider parallel tool calls decide cross-tool fanout unless
  ToolSpec, runtime profile, eval denominator and merge policy explicitly allow
  it.
- Do not expose raw SQL, object-store bytes, OCR dumps, collector runtime or
  ingestion build paths as query-time tools.
- Do not pass canonical notice body, OCR owner text or attachments as public
  function output.
- Do not use a tool catalog as an authorization or source-truth owner.

## Related Documents

- `execution-agent-layer.md`
- `agent-framework.md`
- `tool-routing.md`
- `agentic-retrieval.md`
- `../../contracts/README.md`
