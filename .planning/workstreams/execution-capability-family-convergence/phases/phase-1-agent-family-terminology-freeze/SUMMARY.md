---
phase: "1"
name: "Agent Family Terminology Freeze"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 1 Summary

## What Closed

- 冻结了 repo-wide execution capability family 的三层术语模型：
  - invariant role name
  - current-truth runtime / package / contract label
  - forward family label
- 固定 `supervisor` 为 invariant top-level role name，不引入 `supervisor-agent`。
- 把 `rag-specialist -> rag-agent` 收口成首条 canonical convergence pair。
- 把 `navigation-specialist -> navigation-agent` 收口成 current-vs-forward coexistence rule，而不是继续隐式混用。
- 固定 `campus-services-agent` 与 `notice-agent` 为 canonical forward family label。
- 固定 `availability-specialist` 在后续显式决策前继续保持 legacy current-truth posture，不提前发明 `availability-agent`。
- 把 current architecture、target architecture、execution supporting architecture、navigation ADR 与相关 package README 的术语边界写实，不再让 current truth 与 target truth 互相冒充。

## Fresh Evidence

- `.planning/workstreams/execution-capability-family-convergence/phases/phase-1-agent-family-terminology-freeze/CONTEXT.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-1-agent-family-terminology-freeze/RESEARCH.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-1-agent-family-terminology-freeze/PLAN.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `packages/availability-specialist/README.md`
- `packages/navigation-specialist/README.md`

## Handoff

- `Phase 1` 已正式 completed。
- 下一阶段固定进入 `Phase 2: Current-Truth Contract Label Migration`。
- `Phase 2` 只负责 current-truth contract / operator-facing label migration：
  - `selected_target`
  - shared enum / example payload
  - panel / telemetry / observability 所依赖的 current label surfaces
  不提前跳到 package dir 或 import path rename。
