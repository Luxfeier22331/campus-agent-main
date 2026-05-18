---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 05
phase_name: Cross-Surface Navigation And Session Continuity
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 05: Cross-Surface Navigation And Session Continuity

## Goal

Verify that hub navigation, entry-state display and session continuity work
across the existing product surfaces without overstating unopened capabilities.

## Tasks

1. Add a route smoke matrix for:
   - `/`
   - `/account`
   - `/chat`
   - `/docs`
   - `/map`
   - `/services`
   - `/notices`
   - `/panel`
   - unknown slugs
2. Verify launcher state rendering:
   - `available`
   - `preview`
   - `gated`
   - `coming_soon`
   - `external_legacy`
3. Verify cross-surface links:
   - chat entry opens the public chat surface
   - docs entry opens the public docs surface
   - panel entry respects gated/operator access posture
   - legacy Wiki entry is an external link to `https://muc.wiki`
4. Verify account return-to behavior after login/logout/reset flows.
5. Verify unopened capability cards do not claim serving readiness.
6. Add browser smoke coverage for desktop and mobile viewport layouts.

## Non-Goals

- Do not open map/services/notices serving capabilities.
- Do not add panel self-serve signup.
- Do not implement MediaWiki account linking or federation.
- Do not change app-api capability policy ownership.

## Acceptance Criteria

- Hub route and launcher behavior are covered by focused tests.
- Unknown slugs fail closed.
- Available/gated/preview states render accurately.
- Account return-to works without generic app-api proxying.
- Legacy Wiki remains external-link-only.

## Verification Commands

```bash
pnpm --filter hub-web test
pnpm --filter hub-web test:worker
pnpm --filter hub-web build
pnpm web:lint
git diff --check
```

## Expected Write Set

- `apps/hub-web/src/**`
- `apps/hub-web/test/**`
- `docs/architecture/system/product-runtime-architecture.md`
- `.planning/workstreams/hub-product-entry-and-legacy-wiki-identity/STATE.md`

## Exit Rule

Phase 5 exits when hub can be treated as the product entry surface in smoke
tests without changing unopened capability runtime truth.
