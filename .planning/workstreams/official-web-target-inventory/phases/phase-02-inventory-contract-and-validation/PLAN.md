---
doc_type: plan
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Inventory Contract And Validation

## Goal

Add a canonical page-level target inventory manifest and fail-closed validation.

## Tasks

1. Add `configs/sources/official_web/muc_public/target-inventory.json`.
2. Extend `official-web-core` config loading, path resolution and validation for target inventory.
3. Validate inventory entries against `target-source-map.json` and source host policy.
4. Add report helpers for review state, field blockers and preview lineage blockers.
5. Add tests for successful loading and fail-closed drift cases.

## Verification

- `pnpm --dir packages/official-web-core test -- config target-inventory`
