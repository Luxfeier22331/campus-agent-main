---
doc_type: compatibility_decision
workstream: academic-calendar-campus-services-consolidation
phase: phase-0-inventory-and-boundary-freeze
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Compatibility Decision: No Calendar-Agent Alias

## Decision

Do not keep compatibility aliases for:

- `calendar-agent`
- `requested_capability=academic_calendar`
- `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar`

## Basis

Phase 0 inventory found no external published contract or browser-facing product API that requires
those names.

The references are repo-internal:

- runtime registry
- internal supervisor execution OpenAPI schema
- generated internal Go/Python/TS adapters
- Python worker delegate map
- local Docker packaging
- local smoke/eval profiles
- docs and prior workstream planning

Current architecture also states browser surfaces do not call `apps/supervisor-api` directly, so
`AgentTarget` and `RequestedCapability` in the supervisor execution schema are internal execution
wire terms rather than stable browser-facing product API terms.

## Expected Behavior After Migration

| Old Input | Expected Behavior |
| - | - |
| `target=calendar-agent` | Fail closed as invalid target. |
| `requested_capability=academic_calendar` | Fail closed as invalid requested capability or unsupported capability. |
| `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar` | Startup/config validation error. |
| `SUPERVISOR_API_OPEN_CAPABILITIES=campus_services` | Admits academic calendar lookup when campus-services gate is open. |
| Academic calendar user goal with no explicit capability | Infer `campus_services`; planner selects `academic_calendar_lookup`. |

## Why No Alias

Keeping aliases would preserve the exact complexity this workstream exists to remove:

- duplicate capability naming
- duplicate readiness/opening gate semantics
- duplicate lane budget semantics
- duplicate test/eval expectations
- stale agent target accepted by internal contracts

There is no external migration constraint that justifies this debt.

## Migration Responsibility

All repo-local callers, fixtures and docs must migrate in the same workstream.

If a future deployed environment is discovered to depend on the old names, the correct response is a
separate documented rollout/migration decision, not an untracked alias in this workstream.
