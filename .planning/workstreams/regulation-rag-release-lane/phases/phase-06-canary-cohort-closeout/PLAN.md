---
doc_type: plan
status: completed
created: 2026-05-02
updated: 2026-05-02
---
# Phase 6: Canary Cohort Closeout

## Goal

Prove the implemented regulation RAG release lane behaves correctly for the four
required canary classes:

- current institutional rule
- selected scoped rule that is non-current in real materialized evidence
- historical scoped rule that is non-current in real materialized evidence
- source-truth-only negative notice

## Acceptance

- Current `institutional_rules` candidate reaches `serving_published` only through
  release executor success.
- Selected non-current `scoped_rules` candidates reach `held_search_only`, stay
  non-serving and do not emit current alias cleanup.
- Registry-delta behavior is explicit: non-current source-faithful scoped records
  are selected-record replay inputs, not current-version delta candidates.
- Source-truth-only negative notice has no canonical regulation target record
  and therefore creates no RAG release candidate.
