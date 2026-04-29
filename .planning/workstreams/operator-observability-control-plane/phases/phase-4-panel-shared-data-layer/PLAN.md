---
doc_type: phase_plan
phase: "4"
phase_name: "Panel Shared Data Layer"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 4 Plan

## Objective

把 `protected-panel-web` 从“只有 requests/official-web 已接入、operator observability 仍无共用 substrate”的状态，推进到 `Phase 5-9` 可以直接接入的 shared panel data layer。

## Why This Phase Exists

当前风险不在后端 owner，而在 panel-side consumption truth 还没建立：

- operator observability backend 已闭合
- panel 同站 BFF namespace 已冻结
- 但 panel 还没有统一承接这些 aggregate seam 的 route/data/query foundation

如果跳过这层，后面每个 domain phase 都会自己发明一套 provider method、URL filter、payload type 和错误处理，最后形成 UI 层腐烂。

## Current Baseline

- 已落地：
  - same-site `/api/operator/*` proxy 已存在
  - `react-admin` app 已有 `CustomRoutes`
  - `requests`、`official-web` resource 已有 data-provider / types / tests
  - `/api/overview` 仍承担 auth-provider 与 runtime shell status
- 当前 gap：
  - operator observability aggregate endpoints 还没有 panel-side typed methods
  - 没有 shared operator filters/query-state abstraction
  - 没有 operator aggregate response types/normalizers
  - 没有共用的 domain route shell 和 shared empty/error contract

## Online Best-Practice Alignment

### React Admin

- 依据官方 `CustomRoutes` 文档，非 CRUD domain page 应继续用 custom routes，而不是强行注册为 fake resource。
- 依据官方 Data Provider 文档，panel 应通过扩展 data-provider 方法来承接非标准 aggregate endpoints，而不是反向扭曲 API shape。

### Cloudflare

- 依据 Workers service bindings 文档，`protected-panel-web -> app-api` 继续走 service binding / same-site BFF 组合，不把 panel 改成直连公开 URL 或其他旁路。

## Execution Slices

### Slice 1: Define Shared Operator Query Model

- 在 `apps/protected-panel-web/src/panel/types.ts` 中新增 operator observability shared types：
  - common filter model
  - window/granularity enums
  - aggregate response shapes
  - list/detail payload normalizers
- 明确区分：
  - 壳层/runtime summary types
  - operator observability aggregate types

### Slice 2: Extend Data Provider With Operator Methods

- 在 `apps/protected-panel-web/src/panel/data-provider.ts` 中新增 typed custom methods，至少覆盖：
  - `getOperatorOverview`
  - `getOperatorQualitySummary`
  - `getOperatorQualityTimeseries`
  - `listOperatorQualityBadcases`
  - `getOperatorSafetySummary`
  - `listOperatorSafetyAnomalies`
  - `getOperatorCostSummary`
  - `getOperatorCostTimeseries`
  - `listOperatorAudit`
  - `getOperatorAuditEvent`
- 保持现有 `requests` / `official-web` resource methods 不被破坏
- 不把 operator aggregate seams 伪装成 `getList/getOne` resource contract，除非后续某个域真的天然符合 resource 语义

### Slice 3: Unify Query-State And URL Encoding

- 提炼共用 query helpers：
  - `window`
  - `granularity`
  - `surface`
  - `selectedTarget`
  - `requestedCapability`
  - `principalType`
  - `collection`
  - `modelName`
  - list `limit/cursor`
- 对齐 `app-api` contract：
  - 默认值显式
  - 非法 `window/granularity` 组合 fail-closed
  - 不 silent rewrite
- 如果需要 cursor-based list helper，提炼成通用 helper，而不是每个 domain 重复写一套

### Slice 4: Establish Route Shell And Shared Page Contract

- 在 `apps/protected-panel-web/src/panel/app.tsx` 中为 operator observability domains 预留 custom route shell
- 不在本 phase 内交付最终 domain 页面，但要冻结后续挂载方式
- 保留当前壳层 `/api/overview` 与 auth-provider 行为不变
- 如需当前 UI 占位，只允许使用显式延后页，不允许冒充“已完成页面”

### Slice 5: Shared UX/Error/Copy Contract

- 统一 operator observability domain 的：
  - loading state
  - runtime error presentation
  - empty state contract
  - common labels / copy keys
- 只收口共用 copy，不提前把后续 domain 文案全部写死

### Slice 6: Verification

- `apps/protected-panel-web` verification:
  - `pnpm --dir apps/protected-panel-web test:worker`
  - `pnpm --dir apps/protected-panel-web test`
- affected verification when touched scope expands:
  - `pnpm web:typecheck:affected`
  - `pnpm web:test:affected`
- planning verification:
  - `STATE.md` 当前 phase/plan 指向 `Phase 4`
  - `Phase 5-9` 不再需要重新讨论 shared substrate，直接消费本 phase 产物

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-4-panel-shared-data-layer/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-4-panel-shared-data-layer/PLAN.md`
- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/http.ts`
- `apps/protected-panel-web/src/panel/types.ts`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/test/data-provider.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`

## Exit Rule

`Phase 4` 完成时，仓库应达到：

- operator observability domains 已有统一的 panel-side typed data layer
- common filters/query-state 已对齐 `app-api` contract
- route shell 已固定，后续 domain phase 不再重新发明挂载方式
- 壳层/runtime summary 与 operator observability aggregate truth 已在 panel 侧语义分离
- `Phase 5-9` 可以按 domain 逐个实现，而不是先返工共用 substrate
