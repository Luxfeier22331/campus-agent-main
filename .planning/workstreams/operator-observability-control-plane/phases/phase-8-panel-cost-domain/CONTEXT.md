---
phase: "8"
name: "Panel Cost Domain"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 8 Context

## Goal

交付 `protected-panel-web` 的 `Cost` domain page。

它要把当前只在 `Overview` 里零散可见的 token / estimated cost 信号，收口成真正可用的 operator cost surface：

- token usage summary
- estimated cost summary
- cost timeseries
- by-model cost distribution
- by-surface cost distribution

## Current Truth

- `Phase 4` 已冻结 panel 侧 observability substrate：
  - `/observability/cost` route shell 已存在
  - `getOperatorCostSummary`
  - `getOperatorCostTimeseries`
  - `useQueries + dataProvider + React Query`
- `Phase 5-7` 已完成：
  - `OverviewPage`、`QualityPage`、`SafetyPage` 已成为真实 domain pages
  - `window / surface / selectedTarget` 已冻结成 operator page 的基础 filters
  - `@mui/x-charts` 已成为 panel observability 页的既定图表底座
- 当前 `Cost` 仍只有 delayed shell：
  - 没有真实 page owner
  - 没有 by-model / by-surface breakdown
  - 没有独立的 token / cost timeseries owner
- `OverviewPage` 已消费 `getOperatorCostTimeseries` 与总览 estimated cost，但它只是 overview 摘要，不是 cost domain

## Contract Reality

- `getOperatorCostSummary()` 支持 aggregate filter family：
  - `window`
  - `surface`
  - `selectedTarget`
  - `requestedCapability`
  - `principalType`
  - `collection`
  - `modelName`
- `getOperatorCostTimeseries()` 支持：
  - 上述 aggregate filters
  - `granularity`
- 当前 summary 已提供：
  - `tokens.input / output / cachedInput`
  - `estimatedCost`
  - `byModel`
  - `bySurface`
- 当前 contract **没有**：
  - provider reconciled billing ledger
  - per-request cost queue
  - export / reconcile / budget action

因此 `Phase 8` 应直接围绕现有 summary + timeseries seams 展开，而不是发明新的 billing backend。

## Why This Phase Exists

如果 `Phase 8` 不把 `Cost` 真正展开：

- `Overview` 会继续背负 token / cost 趋势和分布语义，开始膨胀成多域分析台
- by-model / by-surface 成本结构没有独立 owner
- 后续 staging/dev smoke 无法对 cost observability 做单域验收

所以这轮不是“把 overview 里的成本卡再放大一点”，而是要把 cost 作为独立 operator domain page 落地。

## Locked Decisions

### Route Ownership Decision

- `Cost` 的 canonical route 固定为 `/observability/cost`
- 它需要变成明确可导航页面，不能继续只有 delayed shell
- `Overview` 保留 overview owner，不继续承载完整成本治理语义

### Query Composition Decision

- 页面优先消费现有 seams：
  - `getOperatorCostSummary`
  - `getOperatorCostTimeseries`
- 本 phase 默认不新增 `app-api` 成本专用 route
- 页面继续经由 `ProtectedPanelDataProvider`，不直接 `fetch`

### Filter Model Decision

- page 级基础 filters 继续复用已冻结模型：
  - `window`
  - `surface`
  - `selectedTarget`
- `granularity` 不作为第一版显式控件；继续按窗口推导默认粒度
- `modelName` 虽然已有 contract，但本 phase 不作为默认 header filter
  - 原因：页面本身要展示 `byModel` 分布
  - 如果把 `modelName` 提前做成默认筛选，会把最关键的模型分布自己筛没
- `requestedCapability / principalType / collection` 继续不作为本 phase 默认控件，避免页面过早退化成分析台

### Presentation Decision

- page 固定拆成四个区块：
  - summary filters / as-of / 页面说明
  - headline summary cards
  - cost timeseries
  - by-model / by-surface distribution
- 第一版 headline cards 至少展示：
  - estimated cost
  - input tokens
  - output tokens
  - cached input tokens
- distribution 继续使用页面内可读的图表 + 数值摘要，而不是纯表格堆砌

### Visualization Decision

- timeseries 继续使用 `LineChart`
- category distribution 优先使用 `BarChart`
- 本 phase 不引入 pie / donut 作为主图，因为当前需求更强调类别间可比较性，而不是占比装饰
- 第一版继续使用 `@mui/x-charts` 自包含图表，不引入 composition-only chart stack

### Anti-Shortcut Decision

- 不允许把 `Cost` 继续塞回 `Overview`
- 不允许 panel 直连 provider billing API、Axiom 或数据库重算 cost truth
- 不允许在 panel 侧发明 contract 中不存在的 reconciliation / budget 语义
- 不允许为了“页面更饱满”新增 fake queue 或假告警层

## External Best-Practice Inputs

### React Admin

- 官方 `CustomRoutes` 文档说明：custom page 继续通过 `<CustomRoutes>` + `<Route>` 注册，菜单需要手工收口
- 官方 Data Fetching / Actions 文档说明：
  - `react-admin` 继续通过 `dataProvider` + React Query 驱动读取
  - `dataProvider` 可以拥有 CRUD 之外的 custom methods
  - custom page 可以直接组合 `useDataProvider` / query hooks

### MUI X Charts

- 官方文档提供 `LineChart` 与 `BarChart` 自包含组件，适合直接嵌入现有 Material UI card layout
- 现有仓库已经在 `OverviewPage` 中稳定使用 `LineChart`，`Phase 8` 应复用同一图表体系，而不是引入第二套图表栈

### Current Contract

- `cost/summary` 已明确：
  - 第一版返回 near-real-time estimated cost
  - provider reconciled cost 后续如加入，也必须作为独立 aggregate block，而不是覆盖 runtime estimated cost
- `cost/timeseries` 已明确：
  - 使用 app-owned rollup
  - 不从 provider billing API 或 sink 实时查询

## Existing Code Insights

### Relevant Panel Files

- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page.tsx`
- `apps/protected-panel-web/src/panel/pages/overview-domain.ts`

### Relevant Tests

- `apps/protected-panel-web/test/data-provider.test.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/overview-domain.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`

### Relevant Contracts / Docs

- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/domains/operator-observability.md`

## Phase 8 Deliverable Boundary

本 phase 结束时，仓库应具备：

- 真正的 `/observability/cost` page
- 明确可达的 `Cost` 导航入口
- token / estimated cost headline summary
- cost timeseries
- by-model / by-surface distribution presentation
- 与 `Overview` 形成清晰 owner 分工

本 phase 不要求：

- provider reconciled billing block
- budget / threshold / export / ack 写操作
- per-request cost queue
- staging closeout

## Canonical References

- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
