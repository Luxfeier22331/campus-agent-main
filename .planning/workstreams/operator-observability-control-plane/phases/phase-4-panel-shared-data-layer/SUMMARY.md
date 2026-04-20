---
phase: "4"
name: "Panel Shared Data Layer"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 4 Summary

## What Closed

- `protected-panel-web` 已补齐 operator observability shared data layer：`CustomRoutes` 继续承接 domain shell，自定义 `dataProvider` 方法直接消费 `/api/operator/*` aggregate seams，不再把这些接口伪装成 fake CRUD `Resource`。
- panel-side shared query substrate 已冻结：overview filters 默认显式编码 `window=24h`，timeseries `window/granularity` 组合会在前端 fail-closed，queue/list seams 统一走顺序 cursor history。
- operator observability route shell 已预留：
  - `/observability/overview`
  - `/observability/quality`
  - `/observability/safety`
  - `/observability/cost`
  - `/observability/audit`
- 当前壳层 `/api/overview` 继续只承担 auth-provider / runtime shell status；operator aggregate truth 已经在 panel 侧语义分离。

## Fresh Evidence

- `pnpm --dir apps/protected-panel-web typecheck`
- `pnpm --dir apps/protected-panel-web test:worker`

## Handoff

- 下一阶段固定进入 `Phase 5: Panel Overview Domain`。
- `Phase 5` 直接消费 `getOperatorOverview` 与 `/observability/overview` route shell，不再重开 shared route/provider/query strategy 讨论。
