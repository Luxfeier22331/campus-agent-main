---
doc_type: plan
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Operator Inventory Surface

## Goal

Expose target inventory state through `protected-panel-web -> app-api` only.

## Tasks

1. Add app-api operator routes for inventory list and detail.
2. Generate app-api records from the canonical target inventory manifest and
   `official-web-core` report helper.
3. Add protected panel Worker proxy routes.
4. Add panel data-provider list support and filters.
5. Add panel target inventory list UI.

## Verification

- `pnpm --dir apps/app-api test -- official-web-target-inventory.route route-exposure-inventory`
- `pnpm --dir apps/protected-panel-web test -- data-provider.official-web worker.operator-domains official-web-copy-regression panel-shell-copy-regression`
