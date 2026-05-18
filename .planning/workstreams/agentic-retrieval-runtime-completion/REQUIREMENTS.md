---
doc_type: requirements
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Requirements

## Goal

Complete the bounded campus agentic retrieval runtime path so planner truth, step execution,
replan, projection use, grounding and eval attribution are real runtime behavior rather than only
diagnostic summaries.

## In Scope

- Internal `rag-agent` planner decision model.
- Non-live typed retrieval step graph execution for `indexed_lookup`, `entity_resolution`,
  `historical_version_lookup` and `compare_pair_lookup`.
- Bounded semantic replan via retrieval-core `replan_callback`.
- Projection-aware planning summaries from safe `workflow_context.projection_refs`.
- Claim/evidence graph enforcement for completed answers.
- Agentic retrieval eval attribution for planner quality, replan and claim graph failures.

## Non-Goals

- No `fresh_news` opening.
- No default live/latest answer path.
- No general web fallback or provider web search.
- No executable retrieval-core types in `packages/contracts`.
- No retrieval backend ownership of product scope.

## Success Criteria

- Planner stage exposes internal decision truth and derives public safe summaries from it.
- Typed compare/history/entity steps execute through bounded retrieval requests and preserve
  step activity.
- Replan remains scope-, selector- and budget-preserving.
- Projection context is visible as planning framing without raw payload.
- Completed answers fail closed when material claims lack evidence support.
- Eval can attribute failures across planner, step graph, replan and claim/evidence graph.
