---
phase: "K"
name: "Conditional HITL Approval Recovery"
created: 2026-04-19
status: pending
---

# Phase K Context

## Goal

仅在产品重新引入高风险 action execution 时，把当前 `approval_required` terminal semantic outcome 升级为可恢复的人审执行闭环。

## Current Truth

- repo 当前已有 `approval_required` 语义结果、prompt packet 与 panel-visible status
- 但还没有“审批通过后恢复执行”的真实 HITL flow
- 在当前读多写少的问答产品里，这不是前置 blocker，而是条件恢复 phase

## Guardrails

- 不在没有 action execution 场景时提前建审批系统
- 不让 HITL flow 取代 `policy / scope / grounding / source-trust` gate
- 不把 panel 里的“待审批”展示误写成已存在的 execution recovery truth

## Entry

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
