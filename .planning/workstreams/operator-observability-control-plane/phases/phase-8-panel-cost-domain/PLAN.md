---
doc_type: phase_plan
phase: "8"
phase_name: "Panel Cost Domain"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 8 Plan

## Objective

把 `protected-panel-web` 的 `/observability/cost` 从 delayed shell 切成真正的 operator `Cost` domain page。

## Why This Phase Exists

`Phase 5-7` 已经完成 overview / quality / safety owner cutover。下一步如果不把 `Cost` 独立落地：

- `Overview` 会继续承载 token / estimated cost 的深水域语义
- model / surface 成本结构没有独立值守入口
- dev/staging smoke 仍无法对成本域做独立验收

## Current Baseline

- 已具备：
  - `/observability/cost` custom route shell
  - `getOperatorCostSummary`
  - `getOperatorCostTimeseries`
  - `useQueries + dataProvider + React Query`
  - `@mui/x-charts` line-chart substrate
  - `buildCostTrendSeries()` helper
- 未具备：
  - 真正的 `CostPage`
  - cost 中文 copy / helper / presentation contract
  - by-model / by-surface 独立展示 owner
  - explicit cost navigation entry

## Online Best-Practice Alignment

### React Admin

- custom domain page 继续走 `CustomRoutes`
- 菜单需要显式加入 custom route 导航
- 读取路径继续通过 `dataProvider` custom methods + React Query
- 本 phase 不把 cost page 退回 fake CRUD resource

### MUI X Charts

- timeseries 继续使用 `LineChart`
- category comparison 优先使用 `BarChart`
- 第一版继续使用自包含 chart 组件，保持与现有 `Overview` 页一致的图表栈

### Contract-Driven UI

- `cost/summary` 与 `cost/timeseries` 已经是当前真实 contract
- 当前 contract 没有 billing reconciliation / budget queue / per-request cost queue
- 页面不应伪造这些不存在的 owner 语义

## Phase 8 Product Decisions

### Page Composition

页面固定拆成四个区块：

1. 顶部 summary filter / as-of / 页面说明
2. headline summary cards
3. cost timeseries
4. by-model / by-surface distribution

### Summary Scope

Cost 页固定展示这些 summary：

- estimated cost
- input tokens
- output tokens
- cached input tokens

必要时允许补充只读 secondary text，例如：

- USD 单位提示
- cache token 占比
- 当前窗口 request volume 对成本语义的解释

### Distribution Scope

本 phase 固定展示：

- `summary.byModel`
- `summary.bySurface`

每个 distribution 区块至少包含：

- 一个可比较的 category chart
- 一个紧随其后的数值摘要列表或表格

### Filter Scope

本 phase 默认只开放：

- `window`
- `surface`
- `selectedTarget`

本 phase 默认不开放：

- `modelName`
- `requestedCapability`
- `principalType`
- `collection`
- 手工 `granularity`

原因：

- `modelName` 会把 `byModel` breakdown 自己筛没
- 其余 aggregate dimensions 会把页面过早拉向多维分析台
- granularity 继续沿用窗口推导即可

### Timeseries Scope

timeseries 固定消费 `getOperatorCostTimeseries`

默认展示：

- estimated cost trend
- total token trend

默认不拆成多条复杂 stacked series，例如：

- per-model timeseries
- per-surface timeseries
- provider reconciled cost overlay

### Anti-Fake-Reconciliation Decision

本 phase 不新增：

- provider billing reconciliation block
- budget threshold / alerting block
- per-request cost queue
- export / download / settle action

因为这些都不在当前 contract 中。

### Navigation Decision

- `Cost` 必须变成产品内显式可达页面
- 这轮直接在 panel 左侧菜单补 `成本` 入口
- `Phase 9` 再继续补齐 `Audit`

## Execution Slices

### Slice 1: Route And Navigation Cutover

- 新建真实 `CostPage`
- `app.tsx` 中的 `/observability/cost` 从 delayed shell 切到真实页面
- `panel-layout.tsx` 中加入 `成本` 菜单入口
- `panel-copy.ts` 中补齐 cost 中文 copy

### Slice 2: Domain Helpers And Presentation Contract

- 新建 `cost-domain.ts`
  - cost timeseries presenter
  - by-model / by-surface chart data helpers
  - token / estimated cost summary formatter helpers
- 固定 cost page 内部的 card / chart / distribution presenter contract

### Slice 3: Summary Query Orchestration

- 页面级 summary filters：
  - `window`
  - `surface`
  - `selectedTarget`
- 使用 React Query 读取：
  - `getOperatorCostSummary`
  - `getOperatorCostTimeseries`
- 统一 loading / empty / error states

### Slice 4: Timeseries And Distribution Rendering

- 实现 headline summary cards
- 实现 cost timeseries chart
- 实现 by-model distribution
- 实现 by-surface distribution
- distribution 区块追加数值摘要，避免图表成为唯一读法

### Slice 5: Guardrails And Regression

- 回归锁定：
  - `/observability/cost` 不再是 delayed shell
  - 菜单出现 `成本` 入口
  - 页面使用 `getOperatorCostSummary / getOperatorCostTimeseries`
  - 页面不直接 `fetch`
  - 页面不退回 fake CRUD/resource 语义
  - 页面不伪造 billing reconciliation / queue / export action
  - `modelName` 不作为默认页头控件

### Slice 6: Verification

- package verification:
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm --dir apps/protected-panel-web test:worker`
- 增量附加验证（如果影响面扩大）：
  - `pnpm web:typecheck:affected`
  - `pnpm web:test:affected`

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-8-panel-cost-domain/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-8-panel-cost-domain/PLAN.md`
- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/pages/cost-domain.ts`
- `apps/protected-panel-web/src/panel/pages/cost-page.tsx`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`
- `apps/protected-panel-web/test/cost-domain.test.ts`

## Exit Rule

只有在以下条件同时成立时，`Phase 8` 才算完成：

- `/observability/cost` 已切成真实 domain page
- 左侧菜单已出现 `成本` 入口
- 页面稳定消费 `getOperatorCostSummary / getOperatorCostTimeseries`
- 已具备 summary / timeseries / by-model / by-surface 四类展示
- 已有 regression tests 锁定不回退到 delayed shell / fake resource / fake reconciliation
- `pnpm --dir apps/protected-panel-web typecheck`
- `pnpm --dir apps/protected-panel-web test:worker`
