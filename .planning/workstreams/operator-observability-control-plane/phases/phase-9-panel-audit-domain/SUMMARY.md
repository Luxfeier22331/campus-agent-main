---
phase: "9"
name: "Panel Audit Domain"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 9 Summary

## What Closed

- `protected-panel-web` 的 `/observability/audit` 已从 delayed shell 切成真实 operator `Audit` domain page。
- panel 左侧菜单中的 `审计` 已收口到 `/observability/audit`，旧 `/audit` 只保留 canonical redirect。
- `AuditPage` 已固定通过 `listOperatorAudit / getOperatorAuditEvent` 组合读取，不回退为 fake CRUD resource，也不直接 `fetch`。
- 页面已具备：
  - 顶部过滤区与当前筛选摘要
  - curated audit timeline table
  - row-triggered detail drawer
  - request / trace / issue backlink
- `audit-domain.ts` 已冻结第一版事件类型、状态与诊断 presenter helper，避免把 raw code value 和 drawer 细节散落回页面组件。

## Fresh Evidence

- `pnpm --dir apps/protected-panel-web test:worker`
- `pnpm --dir apps/protected-panel-web typecheck`

## Handoff

- 下一阶段固定进入 `Phase 10: Sink Participation And Grade Backflow`。
- `Phase 10` 继续围绕 sink/backflow 收口，不能反向把 panel 变成 `Sentry` / grader / sink query backend。
