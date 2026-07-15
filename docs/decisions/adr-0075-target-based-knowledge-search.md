---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0075
status: accepted
created: 2026-07-12
updated: 2026-07-13
supersedes: ADR-0071
---
# ADR-0075 Target-Based Knowledge Search

## Status

Accepted.

## Context

The Knowledge Agent needs enough freedom to reformulate a question and search
more than one governed knowledge surface. The earlier contract made callers and
handoff arguments carry retrieval scope and version controls. That leaked
retrieval planning into product transport, duplicated serving policy and made a
single knowledge question depend on one preselected collection.

The repository has no compatibility requirement for the earlier contract.

## Decision

OpenAI Agents SDK remains the only semantic agent and tool loop. The primary
agent may answer directly, call a model-visible function tool or use the
official `knowledge_query` handoff. The handoff payload contains only
`query_text`.

Execution-control loads `configs/runtime/query-serving-targets.v1.json` and
injects the admitted target ids and descriptions into the Knowledge Agent
context. The Knowledge Agent can call only internal `knowledge_search` with the
strict payload `{query_text, target, include_history}`. Search and SDK turn
limits come from execution-control `agent_runtime` config; current profiles use
three searches and six turns. The agent searches one target at a time, stops
when evidence is sufficient and does not repeat an identical normalized
target/query/history call. A duplicate returns `duplicate_query` and consumes
one search slot.

A target registry entry maps one semantic id to one `collection` and one
server-owned serving config. It does not repeat `corpus`; corpus remains
offline/serving metadata. Execution-control requires the registry collection
to match the serving config. The model and app-api never receive corpus,
collection, alias, top-k, embedding or vector-store controls. Unknown targets
fail closed. `include_history=false` searches current documents; historical
lookup is an explicit Knowledge Agent choice for historical or comparative
questions.

Execution-control validates run identity and retrieval access, then performs
query embedding and Qdrant dense/sparse retrieval with native RRF fusion. There
is no custom reranker, version resolver, release guard or fallback retrieval
path. Finalization validates terminal evidence refs against the projected
search results and derives browser-safe sources without rewriting the answer.

The complete primary/Knowledge Agent run remains one Temporal Agent Activity
inside the four-phase workflow: Memory Recall, Agent Activity, Finalization and
Memory Append. SDK handoffs and searches do not create Temporal activities.

## Alternatives Considered

### Caller-Selected Scope And Version

Rejected because product transport and eval callers would become retrieval
planners and could drift from the active serving registry.

### Raw Collection Controls In Tool Arguments

Rejected because model-visible infrastructure controls bypass target admission
and leak data-plane topology.

### Go-Owned Retrieval Planner

Rejected because it would duplicate the Knowledge Agent's semantic loop and
turn Temporal into a second agent framework.

### Custom Reranker And Release Guard

Rejected because Qdrant already provides the admitted hybrid retrieval and
fusion path, while serving readiness belongs to the target registry and serving
config rather than a second online policy layer.

## Consequences

- Runtime tool truth is `tools.v5` plus `tool-function-schemas.v2`.
- Query-serving truth is a target registry, not a model-facing scope registry.
- Multi-target and follow-up searches are ordinary bounded SDK tool calls.
- SDK deadline, turn/output, search and context limits are required runtime
  config, not prompt text or request-scoped environment overrides.
- Search results expose bounded evidence and stable refs, not retrieval
  infrastructure.
- Tool-use eval observes the public handoff and internal search sequence through
  `tool_trajectory.v2`.
- `official_web` remains unavailable until it has a published target and
  serving config.
