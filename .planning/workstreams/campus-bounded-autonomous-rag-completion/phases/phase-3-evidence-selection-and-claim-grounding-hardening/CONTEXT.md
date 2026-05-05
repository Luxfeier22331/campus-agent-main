---
doc_type: phase_context
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Context: Evidence Selection And Claim Grounding Hardening

## Goal

Improve answer faithfulness and relevancy by requiring final claims to be backed by answer-bearing
evidence.

## Starting Truth

- `title_lookup` no longer owns answer success.
- Supporting evidence already carries retrieval plan / step / replan provenance.
- RAGAS diagnostics can attribute failures by stage, but claim coverage must be hardened for product
  quality.

## Required Decisions

- What minimum evidence is required for regulations, curriculum and stable official-web answers?
- How partial evidence, contradictory evidence and weak title/entity hits affect final response.
- Which answer claims need explicit evidence anchors and citation back-links.

## Out Of Scope

- Rewriting ingestion canonicalization.
- Adding one-off special cases for specific collections.
- Treating RAGAS judge output as the only answer authority.
