---
doc_type: requirements
status: active
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Requirements: Rag-Agent Answer Contract Hardening

## Goal

Make `rag-agent` answer synthesis explicit and bounded for short-answer surfaces so title lookups,
document identity questions, brief reference questions, and general summary responses do not
expand into overlong summaries.

## Problem Statement

The current retrieval path is mostly correct on the low-scoring cases, but the answer composer is
too permissive:

- title queries are rendered as multi-fragment summaries
- curriculum identity queries can spill into full curriculum descriptions
- official-web reference queries can emit more facts than the question asked for
- general summary joins all supporting fragments when it should only preserve one short answer

The issue is answer contract design, not basic recall.

## In Scope

- `packages/rag-agent` answer-shape and composer logic
- `packages/rag-agent` short-answer presentation kinds and validation helpers
- `packages/rag-agent` selection budget adjustments for title / identity / brief shapes
- `packages/evals` regression cases and ragas smoke coverage
- minimal diagnostic fields needed to explain presentation kind and real fallback / degradation
  reasons

## Out Of Scope

- retrieval baseline redesign
- ingestion semantic extraction
- supervisor routing
- app-api product surfaces
- new query-enabled collections
- broad reranker policy changes

## Success Criteria

1. Title / identity queries return one short identity answer, not a summary chain.
2. Official-web brief queries return a bounded fact set, not a paragraph of page content.
3. General summary returns one short sentence and does not concatenate every fragment.
4. The target answer-relevancy regression cases pass the existing gate again.
5. Stage diagnostics still distinguish retrieval, selection, synthesis, and grounding failure.
6. The answer contract can be explained in code and in planning without relying on implicit prompt
   behavior.

## Design Principles

- Prefer typed presentation kinds over heuristic prose assembly.
- Specialized short-answer contracts must be narrower than general summary composition.
- General summary should never outrank a dedicated short-answer composer.
- Diagnostics must name the presentation kind; fallback fields must stay empty for normal
  presentation routes.
- No new public contract is required unless a consumer proves it is necessary.
