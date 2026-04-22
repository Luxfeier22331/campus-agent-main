---
phase: "9"
name: "Panel Audit Domain"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 9 Context

## Goal

交付 `protected-panel-web` 的 `Audit` domain page。

它要把当前还停留在 delayed shell 的 `/observability/audit`，切成真正可用的 operator audit surface：

- curated audit timeline
- request-scoped audit detail
- trace / issue backlink
- governance-safe diagnostics

## Current Truth

- `Phase 4` 已冻结 panel observability substrate：
  - `/observability/audit` route shell 已存在
  - `listOperatorAudit`
  - `getOperatorAuditEvent`
  - `ProtectedPanelDataProvider` custom methods + React Query 模式已固定
- `Phase 5-8` 已完成：
  - `Overview` / `Quality` / `Safety` / `Cost` 已是实际 domain pages
  - observability custom pages 都继续走 `CustomRoutes`
  - queue/detail 交互已经沉淀出 table + drawer 的既定模式
- 当前 `Audit` 仍只有 delayed shell：
  - 没有真实 page owner
  - 没有 request-scoped curated timeline UI
  - 没有 detail drawer owner

## Contract Reality

- `listOperatorAudit()` 当前支持的 filter family：
  - `requestId`
  - `traceId`
  - `principalType`
  - `surface`
  - `selectedTarget`
  - `eventType`
  - `status`
  - `page`
  - `perPage`
- `getOperatorAuditEvent()` 当前返回：
  - event detail
  - entitlement snapshot id
  - policy projection version
  - requested capability
  - terminal code
  - diagnostics
  - trace / issue backlink
- 当前 contract **没有**：
  - raw audit JSONL replay
  - sink query passthrough
  - operator acknowledge / resolve / export API
  - audit aggregate summary API

因此 `Phase 9` 必须直接围绕现有 list/detail seams 展开，而不是发明新的后端或假 summary。

## Why This Phase Exists

如果 `Phase 9` 不把 `Audit` 真正展开：

- 当前 observability rollout 仍存在一个未完成的主域
- operator 无法在 panel 内完成 request-scoped audit timeline 与 detail drill-down
- dev/staging smoke 不能对 observability control plane 做完整域验收

所以这轮不是“继续保留一个审计占位页”，而是完成 observability domain rollout 的最后一块 panel 主界面。

## Locked Decisions

### Route Ownership Decision

- `Audit` 的 canonical route 固定为 `/observability/audit`
- 它必须切成真实 domain page，不能继续只保留 delayed shell
- 左侧菜单中的 `审计` 应指向 canonical route，而不是另一个壳层占位路径

### Query Composition Decision

- 页面固定消费现有 seams：
  - `listOperatorAudit`
  - `getOperatorAuditEvent`
- 本 phase 默认不新增 `app-api` audit aggregate / export route
- 页面继续经由 `ProtectedPanelDataProvider`，不直接 `fetch`

### Page Model Decision

- `Audit` 是 curated timeline，不是 raw log viewer
- 主页面聚焦 timeline + filter + detail drill-down
- detail 采用 row-triggered drawer
- 第一版不引入独立 detail route，也不引入 split-pane inspector framework

### Filter Model Decision

- 本 phase 只开放 contract 已冻结的 filter family：
  - `requestId`
  - `traceId`
  - `principalType`
  - `surface`
  - `selectedTarget`
  - `eventType`
  - `status`
- 不追加 `window`
  - 原因：audit list contract 当前并未冻结 window aggregate 语义
- 不追加 `collection / modelName / requestedCapability`
  - 原因：这些维度当前不在 audit list seam 中

### Presentation Decision

- 页面固定拆成两个核心区块：
  - 顶部说明与 filter bar
  - audit timeline table
- detail 通过 drawer 展开，展示：
  - 基础事件元信息
  - governance-safe diagnostics
  - trace / issue backlink
  - request detail backlink
- 第一版不伪造 headline KPI cards
  - 原因：当前 contract 没有 audit aggregate summary seam

### Navigation Decision

- `PANEL_COPY.menu.audit` 应收口到 `/observability/audit`
- 旧 `/audit` 不再作为 audit domain truth owner
- 如果保留旧路径，也只能回到 canonical route，不能继续承载独立壳层语义

### Anti-Shortcut Decision

- 不允许把 `Audit` 做成 fake CRUD `Resource`
- 不允许 panel 直接读取 sink/raw log/database
- 不允许为了“界面更丰富”发明 audit summary cards、export action 或 raw payload tab
- 不允许把 detail 回退成只显示 `requestId / traceId` 的空抽屉

## External Best-Practice Inputs

### React Admin

- 官方 `CustomRoutes` 文档说明：custom page 继续通过 `<CustomRoutes>` + `<Route>` 注册，菜单需要显式收口
- 官方 data fetching / actions 文档说明：
  - `useDataProvider()` 可以调用 CRUD 之外的 custom methods
  - custom page 可以直接用 React Query 组合这些读取
- 因此 `Audit` 应继续复用：
  - custom route
  - explicit menu item
  - `dataProvider` custom methods
  - `useQuery` / `useDataProvider`

### Contract-Driven UI

- `Audit` endpoints 已明确冻结为 list/detail read-model seam
- 当前 contract 明确禁止 panel 退回 raw log / sink passthrough
- 因此 UI 只应围绕 timeline + detail 展示，不补 fake infra console

## Existing Code Insights

### Relevant Panel Files

- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/src/panel/pages/quality-page.tsx`
- `apps/protected-panel-web/src/panel/pages/safety-page.tsx`

### Relevant Tests

- `apps/protected-panel-web/test/data-provider.test.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`

### Relevant Contracts / Docs

- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/domains/operator-observability.md`

## Phase 9 Deliverable Boundary

本 phase 结束时，仓库应具备：

- 真正的 `/observability/audit` page
- 明确可达的 `审计` 导航入口
- curated audit timeline table
- request-scoped audit detail drawer
- trace / issue / request backlink
- 与 `Overview / Quality / Safety / Cost` 一致的 custom page owner 模式

本 phase 不要求：

- audit aggregate summary API
- export / acknowledge / resolve 写操作
- raw log / sink explorer
- staging closeout

## Canonical References

- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
