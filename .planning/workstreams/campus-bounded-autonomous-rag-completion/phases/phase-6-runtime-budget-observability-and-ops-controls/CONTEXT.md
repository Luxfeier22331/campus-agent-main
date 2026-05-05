---
doc_type: phase_context
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Context: Runtime Budget, Observability, And Ops Controls

## Goal

Bound campus RAG autonomy with max turns, retrieval steps, tool calls, context budgets, deadlines,
cancel handling and trace-safe diagnostics.

## Starting Truth

- Go supervisor owns request lifecycle, cancellation, lane admission, metrics and fail-close
  response envelope.
- `rag-agent` owns RAG semantic planning, synthesis and grounding.
- RAGAS scoring can be slow because LLM judge/scorer overhead is separate from answer runtime.

## Required Decisions

- Which budgets belong to supervisor runtime versus RAG stage config.
- Which metrics are safe low-cardinality production labels.
- How to expose cancellation and timeout by stage without leaking raw content.
- Where `gpt-5.4` model selection is configured for chat/judge paths if touched.

## Out Of Scope

- Embedding/reranker provider migration.
- Cost budgeting as a hard dollar cap.
- K8s or multi-instance capacity planning unless already present in current runtime configs.
