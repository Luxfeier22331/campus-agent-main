---
phase: "7"
name: "Eleven-Target Acceptance Rerun And Gap Closure"
created: 2026-04-20
status: pending
---

# Phase 7 Context

## Goal

对当前 `11` 条 admitted target 执行 full local-only acceptance rerun，并收口 target-side fail-close gap。

## Current Truth

- 当前 lane 固定为 `11` 条 admitted target，不扩到更宽 source scope
- acceptance rerun 需要同时覆盖 `institutional_rules` 与 `scoped_rules`
- 重点 fail-close 指标固定包括 title、contextualization、identity metadata、semantic-owner lineage、wrapper leak、front matter leak

## Guardrails

- 只消费 target-side validation issues，不重新讨论 promotion / materialization 边界
- `351119` 继续留在 auth workstream，不混入本 phase
- duplicate hold、follow-up not-regulation items 不回流到当前 rerun 白名单

## Entry

- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
