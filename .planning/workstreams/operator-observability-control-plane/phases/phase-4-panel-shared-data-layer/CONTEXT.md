---
phase: "4"
name: "Panel Shared Data Layer"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 4 Context

## Goal

在不提前展开具体 observability domain UI 的前提下，为 `protected-panel-web` 建立可复用的 operator observability 共用数据层：统一 route shell、typed data-provider methods、filter/query-state 约定、通用类型/normalizer，以及一致的错误/空态处理方式。

## Current Truth

- `Phase 1-3` 已完成，`app-api` 已拥有 operator observability aggregate read-model，并已冻结 same-site `/api/operator/*` proxy namespace。
- `protected-panel-web` 当前仍只有三类已消费入口：
  - 壳层 `/api/overview`
  - `requests` resource
  - `official-web` resource
- 当前 `OverviewPage` 读取的是壳层/runtime summary，不是 operator observability aggregate overview。
- `protected-panel-web/src/panel/data-provider.ts` 当前是按 resource 和单个 detail seam 零散扩展：
  - `getOverview`
  - `getRequestObservability`
  - `requests`
  - `officialWebSites`
  - `officialWebRuns`
- 当前还没有为 operator observability domains 预留统一的 panel-side data layer，后续如果直接做 `Overview / Quality / Safety/Authz / Cost / Audit` 页面，会演变成：
  - 每个页面各自拼 query 参数
  - 每个页面各自定义 payload shape
  - 每个页面各自处理 loading / empty / error
  - 最终形成 page-level patch，而不是可演进的 panel substrate

## Why This Phase Exists

`Phase 3` 已经把后端和 BFF namespace 收口了，但 panel 侧还没有对应的共用消费层。

如果现在直接冲进 `Phase 5-9` 的 domain 页面，会立刻出现三类腐烂：

- 同一套 `window / granularity / surface / selectedTarget / requestedCapability / principalType / collection / modelName` 过滤语义被重复实现
- operator aggregate endpoints 被误塞进现有 resource 语义，导致 `react-admin` 页面层被迫承受非 CRUD contract
- 当前壳层 `/api/overview` 与未来 operator overview 的语义继续混用

所以 `Phase 4` 的职责不是做新 dashboard，而是先铺好 panel 侧的正确 substrate。

## Locked Decisions

### Routing Decision

- operator observability domains 继续通过 `react-admin` 的 `CustomRoutes` 承载，而不是硬建成伪 CRUD resource。
- 当前壳层 `/api/overview` 继续保留给 auth-provider 与 runtime shell status，不改写成 operator aggregate truth。
- `Phase 4` 只建立 route shell 和共享入口约定，不要求把菜单或最终页面全部开放。

### Data Provider Decision

- panel 对 operator observability aggregate endpoints 采用 typed custom data-provider methods，而不是把 `quality/summary`、`cost/timeseries` 之类 endpoint 强扭成 `getList/getOne`。
- 现有 `requests` 与 `official-web` resource 继续保留各自 resource 语义，不为了“统一”而被迫重构。

### State Decision

- `window / granularity / filter` 的编码、默认值、合法组合、URL query 映射必须先在共用层统一。
- 非法组合继续 fail-closed，对齐 `app-api` contract，不在前端 silently rewrite。

### Anti-Shortcut Decision

- 不允许 domain 页面直接 `fetch("/api/operator/...")` 绕过 data-provider/shared helper。
- 不允许把 `Overview / Quality / Safety/Authz / Cost / Audit` 先做成一组 copy-paste 页面，再回头提炼。
- 不允许为了页面快速出图，把 operator aggregate endpoints 重新塞回当前壳层 `/api/overview`。

## External Best-Practice Inputs

### React Admin

- 官方建议用 `CustomRoutes` 承接 custom pages，并显式自定义 menu，而不是要求所有页面都挂在 `Resource` 下面。
- Data Provider 是 `react-admin` 与后端 API 的接口层；对非标准 API，应该写自己的 provider 方法，而不是反向改 API 去迎合 CRUD 假设。

### Cloudflare Workers

- Worker-to-Worker 继续以 service bindings 为内部边界；`protected-panel-web -> app-api` 的 same-site BFF 与 service binding 组合保持不变。

## Existing Code Insights

### Relevant Panel Files

- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/http.ts`
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/pages/overview-page.tsx`
- `apps/protected-panel-web/test/data-provider.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`

### Relevant Backend/BFF Files

- `apps/protected-panel-web/src/index.ts`
- `apps/app-api/src/modules/operator-query/service.ts`
- `apps/app-api/src/modules/operator-query/store.ts`
- `docs/contracts/app-api-operator-observability-http.md`

## Phase 4 Deliverable Boundary

本 phase 结束时，仓库应具备：

- operator observability shared route/data-layer substrate
- typed provider methods 与 shared query/filter utilities
- 通用错误/空态/URL query 约定
- 为 `Phase 5-9` 可直接消费的 panel-side foundation

本 phase 不要求：

- 完整的 `Overview / Quality / Safety/Authz / Cost / Audit` 页面
- 最终菜单开放
- staging smoke
- sink/grader backflow

## Canonical References

- `docs/architecture/operator-observability-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/domains/operator-observability.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
