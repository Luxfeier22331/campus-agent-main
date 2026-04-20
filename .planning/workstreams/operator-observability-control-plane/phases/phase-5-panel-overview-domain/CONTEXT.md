---
phase: "5"
name: "Panel Overview Domain"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 5 Context

## Goal

交付 `protected-panel-web` 的第一个真正 operator observability domain page：`Overview`。

它不再继续展示当前壳层 `/api/overview` 的 runtime summary，而是要在 panel 内消费 app-owned operator aggregate truth，形成：

- 总览 KPI 卡片
- 核心趋势图
- alert 摘要
- 基础筛选

## Current Truth

- `Phase 4` 已完成，panel 侧 substrate 已固定：
  - `/observability/overview` route shell 已存在
  - `getOperatorOverview`
  - `getOperatorQualityTimeseries`
  - `getOperatorCostTimeseries`
  - 其他 operator aggregate typed methods
- 当前 `apps/protected-panel-web/src/panel/pages/overview-page.tsx` 仍是旧壳层页面：
  - 只读 `/api/overview`
  - 展示 runtime status、operator context、panel domain rollout
  - 并不是 operator observability overview
- 当前 menu 里的“总览”仍默认指向 `/`
- 当前 repo 里还没有图表依赖；`protected-panel-web` 目前只安装了 `@mui/material` 和 `react-admin`

## Why This Phase Exists

如果 `Phase 5` 不先把 `Overview` 做成真正的 operator domain，那么 panel 会继续处在一种错误中间态：

- 页面上叫“总览”，实际上展示的是壳层/runtime summary
- `/observability/overview` 路由虽然存在，但只是延后占位
- `Phase 6-9` 即使继续做 quality/safety/cost/audit，也缺少一个真正的 control-plane 首页

所以这轮不是“在旧总览页上多塞几张卡”，而是要完成 domain owner cutover。

## Locked Decisions

### Route Ownership Decision

- operator overview 的 canonical route 固定为 `/observability/overview`
- 当前 root/dashboard 不再继续承担最终 operator overview owner
- 旧壳层 `/api/overview` 可以作为辅助 runtime diagnostics seam 被次级展示，但不能再冒充 page truth

### Query Composition Decision

- `Overview` 页优先消费现有 aggregate seams：
  - `getOperatorOverview`
  - `getOperatorQualityTimeseries`
  - `getOperatorCostTimeseries`
- 本 phase 默认不新增 `app-api` overview-specific backend route，除非在执行阶段被真实 blocker 证明现有 contract 不足
- `window` 是 overview 的一等 filter；timeseries `granularity` 由前端按窗口自动映射，不在本 phase 暴露为独立 operator control

### Filter Scope Decision

- `Phase 5` 只开放基础筛选：
  - `window`
  - `surface`
  - `selectedTarget`
- `requestedCapability` / `principalType` / `collection` / `modelName` 暂不作为首页默认控件，避免 overview 一上来退化成高级分析台

### Visualization Decision

- 趋势图优先采用 `@mui/x-charts` 的 self-contained charts，而不是自写 SVG、引入第二套可视化设计语言，或直接嵌入 sink dashboard
- 原因：
  - 现有 panel 已建立在 Material UI 上
  - 官方文档明确把 self-contained charts 作为常见场景的推荐起点
  - 本 phase 只需要稳定的 line/area trend，不需要先上复杂 composition

### Data-Fetching Decision

- `Overview` 页不直接 `fetch`
- 继续经由 `ProtectedPanelDataProvider`
- 页面层 query orchestration 优先采用 React Query 读路径，而不是在单页里手搓多段 `useEffect + AbortController + state fan-out`

### Anti-Shortcut Decision

- 不允许把旧 `OverviewPage` 的壳层 cards 与新 operator cards 混成一个语义模糊页面然后宣称 phase 完成
- 不允许用截图式静态占位图假装“趋势图已接好”
- 不允许为了快速出图而在 panel 侧自行推导不存在于 contract 的指标口径

## External Best-Practice Inputs

### React Admin

- 官方 `CustomRoutes` 文档说明：自定义页面应通过 `<CustomRoutes>` + `<Route>` 注册，且不会自动出现在菜单中，菜单需要手工收口
- 官方 Data Fetching Guide 说明：
  - `react-admin` 通过 Data Provider + React Query 处理数据读取
  - Data Provider 可以拥有标准 CRUD 之外的 custom methods
  - 在自定义页面中可以直接组合 `useDataProvider` 与 React Query hooks

### MUI X Charts

- 官方 Quickstart 说明：
  - Charts package 与当前已有的 `@mui/material` / `react` 配套
  - 对常见图表场景，官方推荐 self-contained charts 作为起点
  - `width` 可选、`height` 必填，适合 panel card 内嵌趋势图

## Existing Code Insights

### Relevant Panel Files

- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page.tsx`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/data-provider.test.ts`

### Relevant Contracts / Docs

- `docs/contracts/app-api-operator-observability-http.md`
- `docs/architecture/operator-observability-architecture.md`
- `docs/domains/operator-observability.md`

## Phase 5 Deliverable Boundary

本 phase 结束时，仓库应具备：

- 真正的 operator overview page
- canonical route / menu cutover
- KPI cards + trend charts + alert summary + basic filters
- 与旧壳层 `/api/overview` 语义分离的首页

本 phase 不要求：

- Quality/Safety/Cost/Audit 各自完整页面
- sink participation / grader backflow
- staging closeout

## Canonical References

- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
