---
phase: "6"
name: "Panel Quality Domain"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 6 Context

## Goal

交付 `protected-panel-web` 的第一个 operator observability 深水域页面：`Quality`。

它要把当前只在 `Overview` 里占一块小趋势图、以及散落在 request detail 里的质量信号，收口成真正可用的 operator quality domain：

- runtime quality summary
- quality trend charts
- sampled grading summary
- badcase queue
- badcase 基础 drill-down

## Current Truth

- `Phase 4` 已冻结 panel 侧 observability substrate：
  - `/observability/quality` route shell 已存在
  - `getOperatorQualitySummary`
  - `getOperatorQualityTimeseries`
  - `listOperatorQualityBadcases`
  - shared sequential cursor helper
- `Phase 5` 已完成：
  - `/observability/overview` 已成为真正 operator overview page
  - `window / surface / selectedTarget` 已被冻结成 operator page 的基础 filters
  - `useQueries + dataProvider + @mui/x-charts` 已成为 panel observability page 的既定底座
- 当前 `Quality` 仍只有 delayed shell：
  - 没有真实 page owner
  - 没有 badcase queue
  - 没有可用的 quality drill-down
- request detail 已经有 observability summary 与 trace backlink，但它是 request-centric，不是 quality-centric queue

## Why This Phase Exists

如果 `Phase 6` 不把 `Quality` 真正展开：

- `Overview` 会继续承载过多质量语义，开始膨胀成分析台
- badcase 没有 queue，无法形成治理入口
- request detail 里的 observability 只能做单请求诊断，不能承担质量域的面向队列治理

所以这轮不是“给总览多加一个按钮”，而是要把 quality 作为独立 operator domain page 落地。

## Locked Decisions

### Route Ownership Decision

- `Quality` 的 canonical route 固定为 `/observability/quality`
- 这个 domain page 需要变成明确可导航页面，不能继续只有 delayed shell
- `Overview` 保留 overview owner，不再继续承载完整 quality queue 语义

### Query Composition Decision

- `Quality` 页优先消费现有 aggregate seams：
  - `getOperatorQualitySummary`
  - `getOperatorQualityTimeseries`
  - `listOperatorQualityBadcases`
- 本 phase 默认不新增 `app-api` quality-specific backend route，除非执行时被真实 blocker 证明当前 contract 不足
- 页面继续经由 `ProtectedPanelDataProvider`，不直接 `fetch`

### Filter Model Decision

- page 级基础 filters 继续复用已冻结模型：
  - `window`
  - `surface`
  - `selectedTarget`
- badcase queue 再额外开放 queue filters：
  - `status`
  - `causeClass`
  - `detectedBy`
- `requestedCapability` / `principalType` / `collection` / `modelName` 仍不作为本 phase 默认控件，避免过早退化成多维分析台

### Queue Rendering Decision

- React Admin 官方 `ListBase` 是 custom list layout 的 headless 方案
- 但 `ListBase` 默认走 `dataProvider.getList(resource)`，而本 workstream 在 `Phase 4` 已冻结：
  - observability domain page 继续走 custom routes
  - 读取继续走 typed custom methods，而不是 fake CRUD resource 语义
- 因此 `Quality` queue 继续消费 `listOperatorQualityBadcases()` custom method，由页面内的 queue controller 驱动，不把 badcase queue 重新包成 fake resource

### Drill-down Decision

- `Quality` 页不新增 badcase detail backend route
- “基础 drill-down” 固定为：
  - 从 queue row 打开页面内详情面板
  - 展示已有 list record 上的 `summary / causeClass / detectedBy / grade / trace backlink`
  - 提供跳转到 request detail 的 deeplink
- resolve / ack / override 不属于本 phase

### Visualization Decision

- 趋势图继续使用 `@mui/x-charts` self-contained charts
- `Quality` 页优先展示 runtime quality trend；sampled grading 先以 summary cards / badges 为主，不先引入第二套重型 chart composition

### Anti-Shortcut Decision

- 不允许把 `Quality` 继续塞回 `Overview` 然后宣称 domain 已完成
- 不允许把 badcase queue 伪装成 CRUD `Resource`
- 不允许 panel 直读 raw sink / raw grade payload / raw logs
- 不允许在 panel 侧虚构 contract 中不存在的 grader 指标

## External Best-Practice Inputs

### React Admin

- 官方 `CustomRoutes` 文档说明：custom page 继续通过 `<CustomRoutes>` + `<Route>` 注册，且菜单需要手工收口
- 官方 Data Fetching / Actions 文档说明：
  - `react-admin` 通过 `dataProvider` + React Query 驱动读取
  - `dataProvider` 可以拥有 CRUD 之外的 custom methods
  - custom page 可以直接组合 `useDataProvider` 与 React Query hooks
- 官方 `ListBase` 文档说明：它适合 custom list layout，但本 phase 不直接采用它的 `getList(resource)` 资源语义

### MUI X Charts

- 官方 Quickstart 说明：
  - self-contained charts 是常见场景的推荐起点
  - 适合嵌入现有 Material UI card layout
  - 当前已在 `Phase 5` 接入，可直接复用

## Existing Code Insights

### Relevant Panel Files

- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page.tsx`
- `apps/protected-panel-web/src/panel/requests/request-list.tsx`
- `apps/protected-panel-web/src/panel/requests/request-show.tsx`
- `apps/protected-panel-web/src/panel/panel-datagrid-header.tsx`
- `apps/protected-panel-web/src/panel/panel-pagination.tsx`

### Relevant Tests

- `apps/protected-panel-web/test/data-provider.test.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`

### Relevant Contracts / Docs

- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/domains/operator-observability.md`

## Phase 6 Deliverable Boundary

本 phase 结束时，仓库应具备：

- 真正的 `/observability/quality` page
- 明确可达的 `Quality` 导航入口
- runtime quality summary + trend presentation
- badcase queue + 基础 drill-down
- 与 `Overview` 形成清晰 owner 分工

本 phase 不要求：

- `Safety/Authz` / `Cost` / `Audit` 页面
- operator resolve / ack / retry 写操作
- 新的 app-api backend route
- staging closeout

## Canonical References

- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
