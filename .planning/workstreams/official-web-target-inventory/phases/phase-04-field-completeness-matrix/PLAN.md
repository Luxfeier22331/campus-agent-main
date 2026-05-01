---
doc_type: plan
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Field Completeness Matrix

## Goal

Represent required downstream fields and blockers without guessing from source locators.

## Tasks

1. Add `required_fields` to each inventory row.
2. Have report generation default missing field status to `missing`.
3. Derive `blocked_fields` only after replayable preview evidence exists.
4. Keep candidate rows blocked by `no_preview_evidence` before preview.

## Verification

- `packages/official-web-core/test/target-inventory.test.ts`
