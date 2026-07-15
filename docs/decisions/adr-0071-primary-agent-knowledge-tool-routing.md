---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0071
status: superseded
created: 2026-07-09
updated: 2026-07-13
supersedes: ADR-0042
superseded_by: ADR-0075
---
# ADR-0071 OpenAI Agents SDK Knowledge Handoff

## Status

Superseded by ADR-0075.

## Context

Ordinary chat needs one model-facing owner for direct answers, function tools
and governed knowledge delegation. A second router or out-of-band knowledge
runtime would split semantic ownership and make one answer span incompatible
execution models.

The system also needs durable timeout/cancel/projection semantics and strict
scope/version/evidence enforcement without exposing retrieval infrastructure to
the model or browser.

## Decision

OpenAI Agents SDK in `apps/agent-runtime` is the only online agent/tool loop
owner.

The primary agent receives the request-scoped model-visible tool set. When it
selects `knowledge_query`, it uses the official SDK `handoff()` API to transfer
control to the Knowledge Agent in the same SDK run.

The Knowledge Agent can call only internal `knowledge_search`. Execution-control
validates run identity, scope and version, performs embedding/Qdrant/optional
rerank, and returns bounded evidence. The Knowledge Agent owns answer synthesis
and evidence-backed structured terminal output.

The complete primary/Knowledge Agent SDK run executes inside one Temporal Agent
Activity. `ToolExecutionWorkflow` has four phases:

1. Memory Recall;
1. Agent Activity;
1. Finalization;
1. Memory Append.

Only workflow, core and agent worker pools exist. SDK handoffs and function-tool
calls do not create additional Temporal activities or queues.

Execution-control finalization validates terminal evidence refs against
projected `knowledge_search` results, generates browser-safe sources and writes
the terminal projection. It does not call a model or rewrite answer text.
App-api persists and streams the finalized answer and sources without rewriting
the answer.

Public chat exposes only product request fields. Trusted eval/debug hints remain
subject to the same SDK, registry, scope/version, evidence and finalization
path.

`official_web` remains closed until its offline canonical document, chunk,
index, release manifest and alias publication chain is complete and its scope is
explicitly added to the query-serving registry. No online web-search provider
or live fallback is admitted.

## Alternatives Considered

### Execution-Control Semantic Router

Rejected because it duplicates the primary agent's semantic decision and makes
tool selection diverge from the real SDK loop.

### Separate Knowledge Worker

Rejected because it splits one agent run across queues and creates a second
answer-generation owner.

### Raw Retrieval As Model-Visible Tool

Rejected because it leaks collection/vector controls and lets the model bypass
scope, version and release admission.

### App-Api Answer Post-Processing

Rejected because product transport must not become a second answer author.

## Consequences

- Tool exposure was governed by the runtime tool registry and strict function
  schemas. Current executable artifacts are `tools.v5.json` and
  `tool-function-schemas.v2.json`; ADR-0075 defines the target-based search
  replacement.
- `knowledge_query` is model-visible; `knowledge_search` is internal-only.
- SDK `maxTurns` is only the SDK run turn budget.
- Temporal owns durable lifecycle, not SDK-internal semantic steps.
- Execution-control owns deterministic evidence/source validation and
  projection, not answer generation.
- Eval separates handoff selection, search/evidence quality, answer quality and
  source-integrity failures.
