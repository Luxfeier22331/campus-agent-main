---
phase: "8"
name: "Panel Cost Domain"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 8 Summary

## What Closed

- `protected-panel-web` 的 `/observability/cost` 已从 delayed shell 切成真实 operator `Cost` domain page。
- panel 左侧菜单已加入 `成本` 入口，`Cost` 不再只是隐藏 route shell。
- `CostPage` 已固定通过 `getOperatorCostSummary / getOperatorCostTimeseries` 组合读取，不回退为 fake CRUD resource，也不直接 `fetch`。
- 页面已具备：
  - summary filter / as-of 顶部区块
  - token / estimated cost headline cards
  - estimated cost / total token timeseries
  - by-model cost distribution
  - by-surface cost distribution
- `buildCostTrendSeries` 已从 `overview-domain` 收口到独立 `cost-domain`，`Overview` 继续复用，但不再持有 cost-specific helper owner。

## Fresh Evidence

- `pnpm --dir apps/protected-panel-web test:worker`
- `pnpm --dir apps/protected-panel-web typecheck`

## Handoff

- 下一阶段固定进入 `Phase 9: Panel Audit Domain`。
- `Phase 9` 直接复用已冻结的 custom route + dataProvider + React Query substrate，不再返工 `Overview` / `Quality` / `Safety` / `Cost` owner 或 fake resource 语义。
