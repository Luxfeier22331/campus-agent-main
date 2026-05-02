---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Source Target Gap Inventory

## Goal

Build a bounded service-info target inventory from downstream field gaps, without reopening broad
official-web crawl.

## Inputs

- `.planning/workstreams/official-web-service-info-target-expansion/FIELD-DENOMINATOR.md`
- `configs/sources/official_web/muc_public/target-source-map.json`
- `configs/sources/official_web/muc_public/consumer-denominator.json`
- `configs/sources/official_web/muc_public/target-inventory.json`
- `packages/official-web-core/src/config-validation.ts`
- `packages/official-web-core/src/target-inventory.ts`

## Tasks

1. Add validation that target-source-map required evidence remains synchronized with
   consumer-denominator required evidence.
2. Add validation that target-inventory required evidence remains synchronized with the referenced
   target-source-map admission target.
3. Update current contact-directory and service-guide inventory rows so they expose the full
   configured denominator as required evidence.
4. Extend target-level required fields so machine review can fail closed on missing email,
   office-hours, service-entry and contact fields.
5. Update operator target-inventory report projection so field status covers both target-specific
   required fields and family-level required evidence.
6. Keep source targets limited to existing source-backed rows in this phase; additional URLs must
   be added only after source-backed gap evidence exists.

## Acceptance Criteria

- Contact and service target rows no longer understate the family-level denominator.
- Config validation fails when a target-source-map or target-inventory row silently relaxes
  required evidence.
- Target inventory reports cannot mark selected-write readiness while family-level evidence is
  missing.
- No host-level, seed-level or news-surface expansion is introduced.

## Verification

```bash
pnpm --filter official-web-core test -- target-inventory
pnpm --filter official-web-core test -- config
pnpm exec markdownlint-cli2 ".planning/workstreams/official-web-service-info-target-expansion/**/*.md" ".planning/workstreams/official-web-service-info-target-expansion/*.md"
```
