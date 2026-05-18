---
doc_type: index
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Workstream: Academic Calendar Campus Services Consolidation

这是 `academic-calendar-campus-services-consolidation` 的 native workstream 入口。

本 workstream 负责把当前单工具 `calendar-agent` 收缩进 `campus-services-agent`：运行时不再把
`academic_calendar_lookup` 表达成独立 agent family，而是把它作为 campus services family 下的
read-only structured tool。数据面 `calendar/academic_calendar` projection / read model 暂不重命名，
因为它是 source/projection owner，不等同于执行层 capability owner。

## Current Status

- status: `completed`
- completed phase: `Phase 5`
- active implementation: none
- current slice: complete
- owner boundary: `configs/runtime` + `apps/supervisor-api` + internal execution contracts +
  `apps/supervisor-agent-worker` + `packages/campus-services-agent` + eval/docs
- target posture: `calendar-agent` retired from active AgentSpec; `academic_calendar_lookup` owned
  by `campus-services-agent`

## Why This Exists

Current repo truth treats academic calendar as its own agent:

- `calendar-agent`
- capability `academic_calendar`
- one tool: `academic_calendar_lookup`

That shape is heavier than the behavior it models. Academic calendar queries are projection-backed,
read-only campus service facts: teaching week, holidays, makeup-class windows and calendar guidance.
They do not need an independent semantic specialist, multi-tool planning boundary, or cross-agent
projection owner.

The correct long-term shape is:

```text
campus-services-agent
-> academic_calendar_lookup
-> internal structured query service
-> calendar/academic_calendar read model
```

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`
- Phase 0 inventory: `./phases/phase-0-inventory-and-boundary-freeze/REFERENCE-INVENTORY.md`
- Phase 0 boundary decision: `./phases/phase-0-inventory-and-boundary-freeze/BOUNDARY-DECISION.md`
- Phase 0 compatibility decision:
  `./phases/phase-0-inventory-and-boundary-freeze/COMPATIBILITY-DECISION.md`
- Phase 0 implementation checklist:
  `./phases/phase-0-inventory-and-boundary-freeze/IMPLEMENTATION-CHECKLIST.md`

## Boundary Notes

- This workstream changes runtime ownership, not source-truth ownership.
- Keep `calendar/academic_calendar` as the projection/read-model target unless a separate data-plane
  workstream explicitly decides to rename it.
- Do not move academic calendar into `rag-agent`; it is deterministic structured lookup, not
  retrieval synthesis.
- Do not move academic calendar into `navigation-agent` or `notice-agent`.
- Do not reopen public product serving policy beyond replacing the independent
  `academic_calendar` capability flag with the existing `campus_services` gate.
- Do not introduce a Go direct-runtime exception for calendar. The current long-term posture for
  `sdk_adapter_admitted` structured tools remains Go-owned single handoff to Python domain-agent SDK
  shell.
- Do not keep a compatibility alias for `calendar-agent`; Phase 0 found no external published
  contract requiring it. Repo-local tests and fixtures should migrate cleanly.
- Contract enum removal must land atomically with Go routing/runtime policy migration. Do not delete
  `calendar-agent` / `academic_calendar` from internal contracts while Go planner still emits them.

## Related Workstreams

- `campus-services-runtime-tool-gap-closeout`
  - completed campus services structured tool readiness
- `agents-sdk-runtime-surface-expansion`
  - completed SDK runtime posture for `academic_calendar_lookup`; this workstream preserves SDK
    execution while changing the owner agent
- `governed-multi-agent-workflow-runtime`
  - completed first governed workflow pilot; this workstream must not reopen multi-step workflow
    semantics
