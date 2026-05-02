---
doc_type: outline
status: planned
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Outline: Source Target Gap Inventory

## Goal

Build a bounded list of official-web source targets from downstream field gaps.

## Planned Deliverables

- Gap matrix comparing current target inventory and structured read models to Phase 0 fields.
- Candidate source list with source URL or deterministic URL hint.
- Target inventory updates only for candidates with downstream owner and service-info fields.
- Exclusion list for pages that are news, marketing, profile-only or unrelated to the two surfaces.

## Planned Checks

- No candidate without downstream field value.
- No host/seed broad crawl expansion.
- Every candidate references an existing target-source-map family.
