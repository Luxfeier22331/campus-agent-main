---
doc_type: architecture
truth_scope: execution
owner_boundary: knowledge-agent
status: active
created: 2026-04-21
updated: 2026-07-13
---
# Knowledge Agent Retrieval

## Boundary

This document owns how the Knowledge Agent plans bounded searches and consumes
governed evidence. The Knowledge Agent runs inside the same OpenAI Agents SDK
run as the primary agent.

It does not define a Temporal retrieval graph, external planner, synthesis
activity or specialist queue.

## Entry And Context

The primary agent selects the official `knowledge_query` handoff with
`{query_text}`. Execution-control supplies the Knowledge Agent with the active
target ids and descriptions from
`configs/runtime/query-serving-targets.v1.json`.

The agent does not receive corpus, collection, serving config path, Qdrant
alias, embedding profile, top-k or source body.

## Search Loop

The Knowledge Agent can call only `knowledge_search`:

```json
{
  "query_text": "focused retrieval query",
  "target": "student_rules",
  "include_history": false
}
```

It searches one target at a time and stops as soon as evidence is sufficient.
A later search may reformulate the query or switch target only when the first
result is insufficient. `include_history=true` is reserved for an explicit
prior-version, as-of-date or comparison question.

The maximum search count comes from execution-control `agent_runtime` config;
current profiles use three. Repeating the same normalized target, query and
history mode returns `duplicate_query` and consumes one search slot. Search
budget exhaustion returns `search_budget_exhausted`.

The agent must answer from evidence returned during the run and include every
supporting evidence ref. A successful search without sufficient evidence ends
as `unsupported_by_evidence`; model memory cannot fill the gap.

## Search Admission

Execution-control validates:

- run, request, trace, invocation and search ordinal identity;
- target membership in the active target registry;
- retrieval visibility and entitlement projection;
- target serving config and Qdrant alias/vector compatibility;
- current-only or history-inclusive filtering;
- evidence and result size bounds.

It then performs query embedding and Qdrant dense/sparse retrieval with native
RRF fusion and bounded evidence shaping.

## Evidence Contract

Each result contains `found`, `no_evidence`, `duplicate_query` or
`search_budget_exhausted`, the resolved target, history mode, candidate/discard
counts, retriever modes, a safe search ref and at most 20 evidence items.

Evidence contains stable evidence, document and chunk ids; target; title; a
bounded snippet; canonical URL; optional version id; rank; and fusion score.
Raw vectors, Qdrant points and provider responses never enter SDK context.

## Finalization And Eval

Execution-control validates terminal evidence refs against completed searches
and derives `resolved_targets[]` plus browser-safe sources. It does not edit the
answer.

`tool_trajectory.v2` records the public handoff separately from internal search
calls. `agent_runtime_eval_projection.v2` adds answer, retrieved contexts,
document ids and resolved targets for Langfuse/Ragas evaluation.

## Related Documents

- `retrieval-serving.md`
- `tool-routing.md`
- `../../contracts/tool-trajectory.md`
- `../../reference/eval.md`
