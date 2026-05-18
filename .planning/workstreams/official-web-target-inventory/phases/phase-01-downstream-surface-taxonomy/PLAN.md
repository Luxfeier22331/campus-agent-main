---
doc_type: plan
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Downstream Surface Taxonomy

## Goal

Freeze the downstream surfaces that may admit official-web target inventory entries.

## Tasks

1. Keep `service_guide_lookup`, `contact_directory_lookup` and `official_web/stable_reference` as
   the only initial target inventory consumers.
2. Keep `fresh_news`, `news_archive`, generic news notices and promotional pages out of serving and
   selected-write scope.
3. Map each admitted surface to the matching consumer family, selected-write target, review policy
   and materialization policy already declared in `target-source-map.json`.
4. Preserve the app-api owned official-web operator boundary for later panel exposure.

## Verification

- `configs/sources/official_web/muc_public/target-inventory.json`
- `packages/official-web-core/test/config.test.ts`
- `packages/official-web-core/test/target-inventory.test.ts`
