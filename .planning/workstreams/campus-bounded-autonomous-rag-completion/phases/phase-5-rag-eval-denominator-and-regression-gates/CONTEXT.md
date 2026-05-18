---
doc_type: phase_context
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Context: RAG Eval Denominator And Regression Gates

## Goal

Make RAG quality and workflow correctness regressions repeatable, attributed and small-sample
runnable.

## Starting Truth

- RAG-only eval currently excludes `fresh_news`.
- RAGAS diagnostics already include failure attribution and performance breakdown.
- Existing golden denominators cover student rules, institutional rules, curriculum plan and stable
  official-web reference.

## Required Decisions

- Which small-sample cases run locally for every RAG quality change?
- Which larger denominator remains release/maturity gate.
- How eval outputs separate retrieval/runtime latency from judge/scorer overhead.

## Out Of Scope

- Budget control by cost ceiling; this workstream controls scale and concurrency instead.
- Treating `fresh_news` as current RAG eval denominator.
- Making LLM judge the sole release authority.
