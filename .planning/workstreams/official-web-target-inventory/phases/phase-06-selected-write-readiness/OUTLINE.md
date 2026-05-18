---
doc_type: outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Outline: Selected-Write Readiness

## Goal

Classify inventory candidates for later selected-write release without performing promotion.

## Planned Deliverables

- Readiness states:
  - `ready_for_selected_write`
  - `blocked_fields`
  - `blocked_source`
  - `blocked_lineage`
  - `inventory_only`
  - `excluded`
- Release blocker taxonomy.
- Handoff payload shape for future selected-write implementation.

## Planned Checks

- No candidate is ready without source URL, preview evidence and field completeness.
- Inventory-only news/notice records cannot be promoted.
- Readiness is explainable from source evidence and review state.
