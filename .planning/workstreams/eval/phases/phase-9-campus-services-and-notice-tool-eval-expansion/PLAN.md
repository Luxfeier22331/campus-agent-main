---
doc_type: phase_plan
phase: "9"
phase_name: "Campus Services And Notice Tool Eval Expansion"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 9 Plan: Campus Services And Notice Tool Eval Expansion

## Objective

为 campus-services 与 notice structured tools 建立 tool-family denominator、fixtures、
release profiles 与 drift report。

## Entry Conditions

- Phase 5A denominator registry completed.
- 对应 tool 的 projection/read-model/runtime surface 已由 domain owner 稳定。
- Phase 6 workflow trace fields 可记录 selected target/tool 与 argument summary。

## Scope

- 覆盖：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `service_guide_lookup`
  - `contact_directory_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- 为每个 tool 定义 smoke / release_gate / regression_locked / exploratory denominator。
- 覆盖 current/latest/effective/current-year miss、not_found、
  temporarily_unverifiable 与 fail-close。

## Non-Goals

- 不实现或重构 tool runtime。
- 不把低优先级 notice 全部提升成 answer-quality gate。
- 不用 generic retrieval qrels 代替 structured tool argument/result correctness。

## Exit Criteria

- 每个 opened tool 都有明确 denominator coverage report。
- release profile 能区分 tool 结果错误、routing 错误、read-model 缺口与
  authorization fail-close。
- future tool 必须先进入 denominator registry，再进入 opening gate。
