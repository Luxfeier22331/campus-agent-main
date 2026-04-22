---
phase: "7"
name: "Panel Safety/Authz Domain"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 7 Context

## Goal

交付 `protected-panel-web` 的 `Safety/Authz` domain page。

它要把当前只在 `Overview` 指标和 request detail 里零散可见的授权/安全信号，收口成真正可用的 operator safety surface：

- decision summary
- fail-close posture
- ACL anomaly posture
- anomaly queue
- anomaly 基础 drill-down

## Current Truth

- `Phase 4` 已冻结 panel 侧 observability substrate：
  - `/observability/safety` route shell 已存在
  - `getOperatorSafetySummary`
  - `listOperatorSafetyAnomalies`
  - shared sequential cursor helper
- `Phase 5-6` 已完成：
  - `OverviewPage` 与 `QualityPage` 已成为真实 domain pages
  - `window / surface / selectedTarget` 已冻结成 operator page 的基础 filters
  - `useQueries + dataProvider + React Query` 已成为 panel observability page 的既定读路径
- 当前 `Safety/Authz` 仍只有 delayed shell：
  - 没有真实 page owner
  - 没有 anomaly queue
  - 没有 fail-close posture 区块
- request detail 已有 request-scoped authz / anomaly 信号：
  - `aclDecision`
  - `aclAnomalyCode`
  - `failClosed`
  - trace / issue backlink
  但它是 request-centric，不是 safety domain-centric queue

## Critical Contract Reality

- `getOperatorSafetySummary()` 支持 aggregate filters：
  - `window`
  - `surface`
  - `selectedTarget`
  - 以及更宽的 aggregate filter family
- `listOperatorSafetyAnomalies()` 当前只支持 queue filters：
  - `severity`
  - `status`
  - `anomalyCode`
  - `limit`
  - `cursor`
- anomaly queue 当前 **不支持** `window / surface / selectedTarget`

因此 `Phase 7` 必须显式区分：

- summary filters
- queue filters

不能在 UI 上伪装不存在的过滤能力。

## Why This Phase Exists

如果 `Phase 7` 不把 `Safety/Authz` 真正展开：

- ACL anomaly / fail-close posture 仍只停在 overview 指标和 request detail 局部字段
- anomaly 没有 queue，无法形成 operator 值守入口
- 后续 `Cost` / `Audit` 即使继续 rollout，operator safety 仍缺少独立 owner

所以这轮不是“多加几张安全指标卡”，而是要把 safety/authz 作为独立 domain page 落地。

## Locked Decisions

### Route Ownership Decision

- `Safety/Authz` 的 canonical route 固定为 `/observability/safety`
- 这个 domain page 需要变成明确可导航页面，不能继续只有 delayed shell
- `Overview` 保留 overview owner，不再继续承担 anomaly queue 语义

### Query Composition Decision

- 页面优先消费现有 seams：
  - `getOperatorSafetySummary`
  - `listOperatorSafetyAnomalies`
- 本 phase 默认不新增 `app-api` safety timeseries route 或 safety detail route，除非执行时被真实 blocker 证明当前 contract 不足
- 页面继续经由 `ProtectedPanelDataProvider`，不直接 `fetch`

### Filter Model Decision

- summary filters 继续复用已冻结模型：
  - `window`
  - `surface`
  - `selectedTarget`
- anomaly queue 只开放当前 contract 真正支持的 filters：
  - `severity`
  - `status`
  - `anomalyCode`
- 不允许把 summary filters 静默套用到 queue，再伪装成真正的 queue filtering

### Presentation Decision

- 本 phase 不强加 safety trend chart
- 原因：
  - 当前 contract 没有 safety timeseries
  - `Phase 7` 的核心是 decision summary、fail-close posture 与 anomaly queue
  - 不应为了“页面看起来更像 dashboard”而虚构不存在的时间序列语义
- summary 区继续使用 cards / posture panels / distribution blocks 即可

### Queue Rendering Decision

- React Admin 官方 `ListBase` 适合 headless list layout
- 但它默认建立在 `getList(resource)` 资源语义上
- 本 workstream 在 `Phase 4-6` 已冻结：
  - observability domain page 继续走 custom routes
  - queue/list 继续消费 typed custom methods
- 因此 anomaly queue 继续消费 `listOperatorSafetyAnomalies()` custom method，而不是 fake CRUD `Resource`

### Drill-down Decision

- `Safety/Authz` 页不新增 anomaly detail backend route
- 基础 drill-down 固定为：
  - row-triggered detail panel
  - anomaly summary / code / severity / principalType
  - request id / trace id / selected target / surface
  - trace / issue backlink
  - request detail deeplink
- resolve / ack / override 不属于本 phase

### Anti-Shortcut Decision

- 不允许把 `Safety/Authz` 塞回 `Overview`
- 不允许把 anomaly queue 伪装成 fake CRUD `Resource`
- 不允许 panel 直读 raw sink、raw audit log 或数据库
- 不允许在 panel 侧拼装不在 contract 中的“安全趋势”

## External Best-Practice Inputs

### React Admin

- 官方 `CustomRoutes` 文档说明：custom page 继续通过 `<CustomRoutes>` + `<Route>` 注册，菜单需要手工收口
- 官方 Data Fetching Guide 说明：
  - `react-admin` 通过 `dataProvider` + React Query 处理读取
  - `dataProvider` 可以拥有 CRUD 之外的 custom methods
- 官方 `ListBase` 文档说明：它适合 headless list，但本 phase 不直接采用其资源化读取语义

### Current Architecture / Contract

- operator observability supporting architecture 已明确：
  - `Safety/Authz` 域负责 ACL decision summary、deny / fail-close posture、projection anomaly、restricted access diagnostics
- HTTP contract 已明确：
  - `safety/summary` 提供 decision distribution、ACL anomaly rate、restricted deny rate、fail closed rate
  - `safety/anomalies` 提供 curated anomaly queue，而不是 raw sink exception list

## Existing Code Insights

### Relevant Panel Files

- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page.tsx`
- `apps/protected-panel-web/src/panel/pages/quality-page.tsx`
- `apps/protected-panel-web/src/panel/requests/request-show.tsx`
- `apps/protected-panel-web/src/panel/panel-pagination.tsx`

### Relevant Tests

- `apps/protected-panel-web/test/data-provider.test.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`

### Relevant Contracts / Docs

- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/domains/operator-observability.md`

## Phase 7 Deliverable Boundary

本 phase 结束时，仓库应具备：

- 真正的 `/observability/safety` page
- 明确可达的 `Safety/Authz` 导航入口
- decision summary + fail-close posture presentation
- anomaly queue + 基础 drill-down
- 与 `Overview` / `Quality` 形成清晰 owner 分工

本 phase 不要求：

- 新的 safety timeseries backend route
- operator resolve / ack / override 写操作
- staging closeout

## Canonical References

- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
