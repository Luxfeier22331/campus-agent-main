---
doc_type: phase_plan
phase: "8"
phase_name: "Public Chat Product Path E2E Eval"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 8 Plan: Public Chat Product Path E2E Eval

## Objective

建立真实 public chat 产品路径 eval，覆盖从浏览器/API 入口到 supervisor runtime、
response contract 与 operator backflow 的端到端 acceptance。

## Entry Conditions

- Phase 6 workflow trace runtime gate completed or available for reuse.
- public-chat / app-api / supervisor-api 的稳定 local or staging smoke path 可用。
- 需要覆盖的 opened capability family 已由对应 domain workstream 给出 denominator。

## Scope

- 覆盖 public-chat-web -> app-api -> supervisor-api -> structured runtime /
  agent -> response。
- 验证 response contract、source trace、citation/card payload、fail-close
  terminal 与 request correlation。
- 验证 quality grade / backlink / feedback candidate 可以回到 operator/eval seam。

## Non-Goals

- 不替代 JS/TS 单元测试或 domain tool release gate。
- 不把 public browser E2E 作为所有 PR 默认 hard gate。
- 不通过 mock answer 伪装真实 product path 已开放。

## Exit Criteria

- public chat product path 有 repo-owned eval profile 或 runbook。
- E2E artifact 可关联 request id / trace id / selected target / terminal outcome。
- opened capability 的 happy path 与 fail-close path 都有最小覆盖。
