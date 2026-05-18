---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Outline: Operator Panel Projection

## Goal

Expose target-first official-web state through `app-api` operator projection and protected panel read-only views.

## Deliverables

- app-api operator query endpoints for target jobs and target job detail.
- Panel list/detail views for target jobs.
- Run detail shows target job linkage, attempt counts, verification and ingestion status.
- No raw object-store/local-path leakage.

## Split From Phase 2

- Phase 2 owns DB/service/operator projection contract.
- Phase 7 owns protected-panel UX and BFF consumption of those app-api routes.
- Phase 7 must not invent additional panel-side aggregation truth.

## Non-Goals

- No panel write actions.
- No collector trigger button.
- No object download proxy.

## Acceptance

- Operator can answer: what target are we collecting, why these URLs, what was fetched, what was retained, what entered review/release.
- Panel errors surface app-api failures directly.
- Panel only calls protected Worker BFF -> app-api operator routes.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web-query
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
```
