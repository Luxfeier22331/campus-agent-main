---
doc_type: requirements
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Requirements: Academic Calendar Campus Services Consolidation

## Goal

Retire `calendar-agent` as an active runtime agent and make `academic_calendar_lookup` a
`campus-services-agent` structured read-only tool, while preserving the existing
`calendar/academic_calendar` projection and read model.

## Problem Statement

Current state over-models academic calendar as a standalone agent family:

- `configs/runtime/agents.v1.json` contains active `calendar-agent`.
- `configs/runtime/tools.v1.json` assigns `academic_calendar_lookup` to `calendar-agent` and
  capability `academic_calendar`.
- Go planner and runtime policy can route explicit calendar facts to independent
  `academic_calendar` capability.
- Python worker has separate calendar delegate wiring.
- Eval fixtures and docs expect selected target `calendar-agent`.

This adds registry, planner, delegate, eval and rollout complexity for a single deterministic
structured lookup tool.

## In Scope

- `configs/runtime/agents.v1.json`
  - remove active `calendar-agent`
  - add `academic_calendar_lookup` to `campus-services-agent`
- `configs/runtime/tools.v1.json`
  - change `academic_calendar_lookup.owner_agent` to `campus-services-agent`
  - change capability to `campus_services`
  - keep `runtime_posture=sdk_adapter_admitted`
- Go runtime policy and structured planning
  - route academic calendar signals into `campus_services`
  - plan `academic_calendar_lookup` as `campus-services-agent`
  - remove independent `academic_calendar` product gate as runtime owner
- Python worker
  - remove active `calendar-agent` delegate path
  - execute `academic_calendar_lookup` through campus-services SDK / thin adapter path
- `packages/campus-services-agent`
  - accept `AcademicCalendarLookupPayload`
  - call existing academic calendar query service through the worker-owned query adapter
  - shape bounded `AgentResponse` consistently with other campus-services tools
- `packages/calendar-agent`
  - retire as active runtime owner
  - either delete package code if no remaining imports exist, or leave only documented legacy-free
    removal evidence in this workstream; no active AgentSpec entry may remain
- Contracts and fixtures
  - remove `calendar-agent` from allowed agent targets
  - keep `academic_calendar_lookup` payload/result DTOs
  - update execution fixture matrix and eval traces to selected target `campus-services-agent`
- Docs
  - update current architecture, execution/agents architecture, campus-services architecture,
    app-api supervisor execution contract and deployment readiness docs

## Out Of Scope

- Renaming `calendar/academic_calendar` data-plane collection or PostgreSQL read model.
- Rebuilding academic calendar source truth.
- Changing academic calendar payload/result schema unless required by owner-agent migration.
- Opening a new product serving surface.
- Reopening governed multi-agent workflow semantics.
- Moving academic calendar into generic RAG.
- Keeping `calendar-agent` as a compatibility alias.

## Success Criteria

- No active AgentSpec entry for `calendar-agent`.
- `academic_calendar_lookup` is owned by `campus-services-agent` in ToolSpec.
- Go planner emits:
  - target `campus-services-agent`
  - payload kind `academic_calendar_lookup`
  - selected tool `academic_calendar_lookup`
- `SUPERVISOR_API_OPEN_CAPABILITIES=campus_services` is sufficient for academic calendar product
  path admission; independent `academic_calendar` opening is removed or rejected.
- Python dispatch accepts academic calendar handoff only through `campus-services-agent`.
- SDK adapter path still admits `academic_calendar_lookup`.
- Public/eval trace expects `selected_target=campus-services-agent`.
- `calendar/academic_calendar` read model remains the data source.
- Repo docs no longer describe `calendar-agent` as current accepted runtime truth.

## Regression Cases

- “今天第几教学周”
- “五一放几天”
- “哪周补课”
- “校历怎么看”
- explicit `requested_capability=campus_services` with `academic_calendar_lookup` intent
- old explicit `requested_capability=academic_calendar` must fail closed

## Design Principles

- Runtime owner and data-plane owner are separate concepts.
- Single-tool deterministic lookup should not become an independent agent family by default.
- The migration should simplify AgentSpec and capability routing, not add aliases or second paths.
- SDK remains an execution substrate for admitted read-only structured tools; it must not own
  routing, ToolSpec, AgentSpec or finalization.
