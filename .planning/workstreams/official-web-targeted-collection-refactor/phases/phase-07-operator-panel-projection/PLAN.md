---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Operator Panel Projection

## Goal

Expose target-first official-web collection state through app-api operator projection and protected panel read-only views.

## Deliverables

- app-api operator query endpoints expose target jobs, candidate URLs, attempts, artifact verification summary, and ingestion/release status.
- protected panel renders official-web target job list and detail views from app-api only.
- run/detail projection shows target linkage, attempt counts, verification status, target-family projection report, selected-write/release gate state, and last error.
- no object-store key, local path, or collector filesystem path is exposed as a panel navigation contract.

## Implementation Tasks

1. Review existing app-api official-web query routes and protected-panel official-web surfaces.
2. Add missing app-api read-model projection for Phase 2/6 target job and ingestion status fields.
3. Add protected-panel list/detail components and route wiring for target jobs.
4. Add tests that prove panel reads app-api projection instead of object storage/local artifacts.
5. Keep official-web operator projection read-only; no collector trigger or mutation actions in this phase.

## Non-Goals

- No panel write actions.
- No collector trigger button.
- No object download proxy.
- No direct panel access to object storage, worker inbox, collector local output, or telemetry sink.

## Acceptance

- Operator can answer: what target are we collecting, why these URLs, what was fetched, what was retained, what entered review/release.
- Panel errors surface app-api failures directly.
- Panel only calls protected Worker BFF -> app-api operator routes.
- Phase 6 target-family and target-lineage report fields are visible in operator-safe shape when present.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
```
