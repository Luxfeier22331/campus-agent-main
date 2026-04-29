---
phase: "7"
name: "Panel Safety/Authz Domain"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 7 Summary

## What Closed

- `protected-panel-web` 的 `/observability/safety` 已从 delayed shell 切成真实 operator `Safety/Authz` domain page。
- panel 左侧菜单已加入 `安全与授权` 入口，`Safety/Authz` 不再只是隐藏 route shell。
- `SafetyPage` 已固定通过 `getOperatorSafetySummary / listOperatorSafetyAnomalies` 组合读取，不回退为 fake CRUD resource，也不直接 `fetch`。
- 页面已具备：
  - summary filter / as-of 顶部区块
  - decision summary cards
  - fail-close / restricted deny / ACL anomaly posture 区块
  - anomaly queue
  - row-triggered 基础 detail drawer
- queue filters 与 summary filters 已显式分区，前端不再暗示 anomaly queue 会被 aggregate filters 隐式过滤。

## Fresh Evidence

- `pnpm --dir apps/protected-panel-web test:worker`
- `pnpm --dir apps/protected-panel-web typecheck`

## Handoff

- 下一阶段固定进入 `Phase 8: Panel Cost Domain`。
- `Phase 8` 直接复用已冻结的 custom route + dataProvider + React Query substrate，不再返工 `Overview` / `Quality` / `Safety` owner 或 queue semantic。
