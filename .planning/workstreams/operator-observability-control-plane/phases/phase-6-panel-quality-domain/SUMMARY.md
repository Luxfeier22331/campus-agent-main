---
phase: "6"
name: "Panel Quality Domain"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 6 Summary

## What Closed

- `protected-panel-web` 的 `/observability/quality` 已从 delayed shell 切成真实 operator quality domain page。
- panel 左侧菜单已加入 `质量` 入口，`Quality` 不再只是隐藏 route shell。
- `QualityPage` 已固定通过 `getOperatorQualitySummary / getOperatorQualityTimeseries / listOperatorQualityBadcases` 组合读取，不回退为 fake CRUD resource，也不直接 `fetch`。
- 页面已具备：
  - runtime quality summary
  - quality trends
  - sampled grading summary
  - badcase queue
  - row-triggered 基础 drill-down
- badcase drill-down 已接入 request detail deeplink 与 sink backlinks，形成最小治理闭环。

## Fresh Evidence

- `pnpm --dir apps/protected-panel-web test:worker`
- `pnpm --dir apps/protected-panel-web typecheck`

## Handoff

- 下一阶段固定进入 `Phase 7: Panel Safety/Authz Domain`。
- `Phase 7` 直接复用已冻结的 custom route + dataProvider + React Query + charts substrate，不再返工 `Overview` / `Quality` owner 或 queue semantic。
