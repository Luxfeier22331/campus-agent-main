---
doc_type: phase_plan
workstream: academic-calendar-campus-services-consolidation
phase: phase-0-inventory-and-boundary-freeze
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Inventory And Boundary Freeze

## Goal

Freeze the migration boundary before implementation: prove what currently references
`calendar-agent`, decide whether compatibility aliases are needed, and produce the edit checklist for
moving `academic_calendar_lookup` under `campus-services-agent`.

## Inputs To Inspect

- `configs/runtime/agents.v1.json`
- `configs/runtime/tools.v1.json`
- `packages/contracts/src/campus_contracts/models_shared.py`
- `apps/supervisor-api/internal/runtimepolicy/*`
- `apps/supervisor-api/internal/structuredplanning/*`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*`
- `packages/calendar-agent/`
- `packages/campus-services-agent/`
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`
- docs under `docs/architecture`, `docs/contracts` and `docs/environment`

## Tasks

1. Produce `REFERENCE-INVENTORY.md`.
   - Group references by registry, Go runtime, Python worker, package, eval, docs and environment.
   - Mark each reference as `migrate`, `delete`, `keep_data_plane`, or `verify_external`.
2. Produce `BOUNDARY-DECISION.md`.
   - Record runtime owner as `campus-services-agent`.
   - Record data-plane owner as `calendar/academic_calendar`.
   - Record that `calendar-agent` should not remain an active AgentSpec target.
3. Produce `COMPATIBILITY-DECISION.md`.
   - Default decision: no compatibility alias.
   - Only override if Phase 0 finds an external published contract or deployed surface that still
     requires `calendar-agent` or `requested_capability=academic_calendar`.
4. Produce `IMPLEMENTATION-CHECKLIST.md`.
   - Exact file groups and test gates for Phases 1-5.

## Exit Criteria

- Every active reference to `calendar-agent` and `academic_calendar` is accounted for.
- The no-alias decision is explicit or a concrete external compatibility dependency is documented.
- Implementation can start without rediscovering the blast radius.

## Completion Evidence

- `REFERENCE-INVENTORY.md` accounts for active runtime, data-plane, metadata, eval, test and docs
  references.
- `BOUNDARY-DECISION.md` freezes runtime owner as `campus-services-agent` and data-plane owner as
  `calendar/academic_calendar`.
- `COMPATIBILITY-DECISION.md` records no alias for `calendar-agent`, `requested_capability=academic_calendar` or
  `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar`.
- `IMPLEMENTATION-CHECKLIST.md` names the file groups and validation gates for Phases 1-5.

## Verification

```bash
rg -n "calendar-agent|academic_calendar|academic_calendar_lookup|packages/calendar-agent|SUPERVISOR_API_OPEN_CAPABILITIES=.*academic_calendar" configs docs apps packages tests .planning
pnpm exec markdownlint-cli2 .planning/workstreams/academic-calendar-campus-services-consolidation/README.md .planning/workstreams/academic-calendar-campus-services-consolidation/REQUIREMENTS.md .planning/workstreams/academic-calendar-campus-services-consolidation/ROADMAP.md .planning/workstreams/academic-calendar-campus-services-consolidation/STATE.md .planning/workstreams/academic-calendar-campus-services-consolidation/phases/phase-0-inventory-and-boundary-freeze/PLAN.md .planning/workstreams/academic-calendar-campus-services-consolidation/phases/phase-0-inventory-and-boundary-freeze/REFERENCE-INVENTORY.md .planning/workstreams/academic-calendar-campus-services-consolidation/phases/phase-0-inventory-and-boundary-freeze/BOUNDARY-DECISION.md .planning/workstreams/academic-calendar-campus-services-consolidation/phases/phase-0-inventory-and-boundary-freeze/COMPATIBILITY-DECISION.md .planning/workstreams/academic-calendar-campus-services-consolidation/phases/phase-0-inventory-and-boundary-freeze/IMPLEMENTATION-CHECKLIST.md .planning/WORKSTREAMS.md
git diff --check
```
