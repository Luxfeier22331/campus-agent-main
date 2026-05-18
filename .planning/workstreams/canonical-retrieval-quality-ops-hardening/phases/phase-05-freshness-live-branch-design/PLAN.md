---
doc_type: phase_plan
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Freshness And Live-Assisted Branch Design

## Objective

将 freshness-sensitive 与 live-assisted retrieval 显式化，避免动态事实问题被默认 current index
静默回答。

## Tasks

1. Define query mode semantics:
   - `current`
   - `freshness_sensitive`
   - `live_assisted`
2. Define freshness SLA and release-age checks per collection/surface.
3. Define planner/admission behavior for dynamic facts.
4. Define live evidence shape:
   - source timestamp
   - retrieval mode
   - as-of marker
   - not canonical index truth
5. Add eval cases:
   - outdated answer should fail closed
   - false premise should not force retrieval
   - recent notice should require live/current source branch
6. Update architecture and runbook.

## Verification

- Contract/model tests if query mode fields change.
- Retrieval planner/service tests for explicit freshness/live admission.
- Eval cases for outdated/current/live distinction.

## Exit Criteria

- Default current retrieval behavior remains stable.
- Freshness/live branches are explicit and auditable.
- Live evidence cannot be mistaken for canonical release truth.
