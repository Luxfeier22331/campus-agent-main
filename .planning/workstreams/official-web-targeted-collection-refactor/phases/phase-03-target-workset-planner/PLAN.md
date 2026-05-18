---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Target Workset Planner

## Goal

Replace host-first `/api/official-web/plans:resolve` semantics with target-scoped workset resolution.

## Deliverables

- Planner request/response contract update.
- Workset rows with target job id, candidate id, normalized URL, host policy, fetch profile and reason code.
- Budgeting per target and per host.
- Repair behavior scoped to failed target attempts.

## Planner Rules

- No workset without target job admission.
- Host filter can only narrow a target job; it cannot create target scope.
- Repair can only retry previous candidate attempts.
- Listing pages are discovery-only unless target declaration admits them.
- Workset rows must carry canonical consumer family names; `public_notice_inventory` is forbidden as a wire family.

## Implementation Tasks

1. Extend planner contract with target job id, candidate id, target declaration version, consumer family, selected-write target and workset reason.
2. Change app-api planner store to read admitted target jobs and candidate rows rather than using enabled hosts as the frontier.
3. Preserve backward-compatible `duePages` response shape only as a target-workset page list, not host-first discovery.
4. Make repair mode source rows from previous target attempts only.
5. Add app-api tests proving hostFilter only narrows target jobs and enabled hosts alone create no workset.
6. Update collector control-plane type shape so Phase 4 can execute returned worksets without reading host seeds as default frontier.

## Non-Goals

- No crawler frontier rewrite yet.
- No selected-write logic in planner.

## Acceptance

- Planner output is sufficient for collector to run without reading host seeds as default frontier.
- Planner output records why each URL is present.
- Tests prove enabled hosts alone do not create workset rows.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web-planner
pnpm --dir apps/app-api typecheck
pnpm --dir apps/official-web-collector typecheck
pnpm exec biome check apps/app-api/src/modules/official-web-planner apps/app-api/test/official-web-planner.route.test.ts apps/official-web-collector/src/control-plane-types.ts
```
