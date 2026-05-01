---
doc_type: plan
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Selected-Write Readiness

## Goal

Classify targets for future selected-write release without writing current truth.

## Tasks

1. Add canonical review states:
   `candidate`, `previewed`, `blocked_fields`, `blocked_lineage`, `blocked_source`,
   `inventory_only`, `ready_for_selected_write`, `excluded`.
2. Require complete app-api/source-truth preview lineage before readiness.
3. Require all required fields to be present before selected-write readiness.
4. Preserve inventory-only as non-promotable.

## Verification

- `packages/official-web-core/test/target-inventory.test.ts`
