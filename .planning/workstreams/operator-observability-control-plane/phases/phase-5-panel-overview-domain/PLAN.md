---
doc_type: phase_plan
phase: "5"
phase_name: "Panel Overview Domain"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 5 Plan

## Objective

把 `protected-panel-web` 的“总览”从壳层/runtime summary 页面，切成真正的 operator observability overview domain。

## Why This Phase Exists

`Phase 4` 只完成了 substrate。现在如果不完成 `Overview` 首页 cutover：

- panel 首页会继续显示错误 truth owner
- `/observability/overview` 仍只是空壳
- 后续 quality/safety/cost/audit 页面也没有统一的 control-plane 首页承接

## Current Baseline

- 已具备：
  - `/observability/overview` custom route shell
  - operator aggregate typed data-provider methods
  - quality/cost timeseries seam
  - shared queue cursor helper
- 未具备：
  - 真正的 operator overview page
  - 首页 filter state / query orchestration
  - charts 依赖与组件
  - root/menu 对 canonical overview route 的 cutover

## Online Best-Practice Alignment

### React Admin

- 自定义 domain page 继续走 `CustomRoutes`
- 菜单必须显式指向 custom route
- 自定义读取场景继续经由 `dataProvider`，并用 React Query 组合多条只读 seam

### MUI X Charts

- 趋势图优先使用 self-contained charts
- 图表容器直接嵌在 MUI cards 内部，保持单一设计系统

## Phase 5 Product Decisions

### Page Composition

页面固定拆成四个区块：

1. 顶部 filter / as-of 条
2. KPI summary cards
3. 核心趋势图区
4. alert / runtime health 摘要区

### KPI Scope

首页固定展示最小 KPI：

- request volume
- latency p50 / p95 / p99
- failure rate
- empty recall rate
- citation miss rate
- refusal rate
- ACL anomaly rate
- estimated cost
- sink health

### Trend Scope

首页固定只做两张趋势图：

- quality trend
  - empty recall
  - citation miss
  - no answer / needs clarification
- cost trend
  - estimated cost
  - token usage

不在本 phase 加第三张 safety trend chart，避免首页过度膨胀。

### Alert Scope

- 首页 alert 摘要直接消费 `getOperatorOverview().alerts`
- 默认展示最近 open alerts
- `incidentBackfill.required=true` 需要在 copy 上明确标注，而不是隐藏在 tooltip 里

### Runtime Status Scope

- 旧 `/api/overview` 仅以“运行时/接缝状态”次级卡片存在
- 不再占据整页主标题和主语义

## Execution Slices

### Slice 1: Route And Owner Cutover

- 新建/替换 operator overview page component
- `CustomRoutes` 中的 `/observability/overview` 从 delayed shell 切到真实页面
- 左侧菜单“总览”改为指向 `/observability/overview`
- root dashboard 收口到 canonical overview route
- 旧壳层 overview 页面若保留，必须改成明确的 runtime diagnostics 语义，而不是继续叫 overview

### Slice 2: Query Orchestration And Filter Model

- 新增 overview page 级 filter state：
  - `window`
  - `surface`
  - `selectedTarget`
- 提炼 `window -> granularity` mapping helper：
  - `15m -> 5m`
  - `1h -> 15m`
  - `24h -> 1h`
  - `7d -> 1d`
  - `30d -> 1d`
- 使用 React Query 并行读取：
  - `getOperatorOverview`
  - `getOperatorQualityTimeseries`
  - `getOperatorCostTimeseries`
  - 可选 `getOverview` 仅用于次级 runtime diagnostics 卡片

### Slice 3: KPI And Trend Presentation

- 建立 overview KPI card 组件族
- 引入 `@mui/x-charts`
- 实现：
  - quality line chart
  - cost line chart
- 统一：
  - 空态
  - loading skeleton / pending state
  - error card

### Slice 4: Alert And Runtime Summary

- 将 `alerts[]` 渲染成 operator alert summary list
- 对 `incidentBackfill.required` 做显式 badge/copy
- 把旧 runtime seam 降级为次级状态卡片：
  - runtime
  - protected hostname
  - protection envelope
  - runtime API base

### Slice 5: Copy, Navigation, And Guardrails

- 更新 `panel-copy.ts`：
  - overview page 标题
  - KPI 标签
  - alert copy
  - runtime diagnostics 文案
- 加回归，锁定：
  - overview menu 指向 `/observability/overview`
  - 不再把 operator overview 建在 `/api/overview` truth 上
  - charts 与 filters 使用明确的中文 copy

### Slice 6: Verification

- package verification:
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm --dir apps/protected-panel-web test:worker`
- 增量附加验证（如依赖面扩大）：
  - `pnpm web:typecheck:affected`
  - `pnpm web:test:affected`

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-5-panel-overview-domain/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-5-panel-overview-domain/PLAN.md`
- `apps/protected-panel-web/package.json`
- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page.tsx`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`

## Exit Rule

`Phase 5` 完成时，仓库应达到：

- `/observability/overview` 成为真正的 operator overview page
- panel 菜单与 root 首页不再把壳层 `/api/overview` 当作产品总览真相
- KPI / trends / alerts / basic filters 已能在单页内稳定工作
- 后续 `Phase 6-9` 只需要补各自 domain page，不再返工首页 owner 和图表底座
