---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Outline: Target Workset Planner

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
pnpm --dir apps/official-web-collector test -- control-plane
```
