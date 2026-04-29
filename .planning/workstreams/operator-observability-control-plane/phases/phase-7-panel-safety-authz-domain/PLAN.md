---
doc_type: phase_plan
phase: "7"
phase_name: "Panel Safety/Authz Domain"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 7 Plan

## Objective

把 `protected-panel-web` 的 `/observability/safety` 从 delayed shell 切成真正的 operator `Safety/Authz` domain page。

## Why This Phase Exists

`Phase 5-6` 已完成 overview 与 quality 的 owner cutover。下一步如果不把 `Safety/Authz` 独立落地：

- fail-close posture 仍只停在 request detail / overview 摘要里
- ACL anomaly 没有 queue，无法形成 operator 值守入口
- safety governance 继续缺少独立 domain owner

## Current Baseline

- 已具备：
  - `/observability/safety` custom route shell
  - `getOperatorSafetySummary`
  - `listOperatorSafetyAnomalies`
  - `useQueries + dataProvider + React Query` operator page substrate
  - shared sequential cursor helper
- 未具备：
  - 真正的 `SafetyPage`
  - safety/authz 中文 copy / helper / presentation contract
  - anomaly queue controller
  - anomaly detail drill-down
  - explicit safety navigation entry

## Online Best-Practice Alignment

### React Admin

- custom domain page 继续走 `CustomRoutes`
- 菜单需要显式加入 custom route 导航
- 读取路径继续通过 `dataProvider` custom methods + React Query
- `ListBase` 虽然适合 headless list，但本 phase 不把 anomaly queue 包成 fake CRUD resource

### Contract-Driven UI

- `safety/summary` 与 `safety/anomalies` 已经是当前真实 contract
- 当前 contract 不含 safety timeseries，因此页面不强行新增图表驱动的假趋势层
- queue 过滤能力必须严格服从现有 contract，不在前端 silently rewrite

## Phase 7 Product Decisions

### Page Composition

页面固定拆成四个区块：

1. 顶部 summary filter / as-of / 页面说明
2. decision summary cards
3. fail-close / authz posture 区块
4. anomaly queue + detail drill-down

### Summary Scope

Safety/Authz 页固定展示这些 summary：

- decision distribution
  - `allowed`
  - `approvalRequired`
  - `denied`
  - `failClosed`
- ACL anomaly rate
- restricted deny rate
- fail closed rate

### Posture Scope

本 phase 的 posture 区块固定回答：

- 当前窗口内 fail-close 是否在发生
- restricted deny 的压力水平
- ACL anomaly 当前是否存在值得值守的风险

它是 operator posture summary，不是告警阈值自动化系统。

### Queue Scope

queue 固定消费 `listOperatorSafetyAnomalies`

默认支持：

- cursor pagination
- `severity`
- `status`
- `anomalyCode`

默认列至少包括：

- detected at
- summary
- anomaly code
- severity
- principal type
- surface
- selected target
- request id

### Filter Separation Decision

页面明确拆成两类 filters：

- summary filters
  - `window`
  - `surface`
  - `selectedTarget`
- queue filters
  - `severity`
  - `status`
  - `anomalyCode`

不在 UI 上暗示 queue 也被 `window/surface/selectedTarget` 真正过滤。

### Drill-down Scope

基础 drill-down 固定为 row-triggered detail panel：

- anomaly summary / code / severity / principalType
- request id / trace id / selected target / surface
- issue / trace backlink
- request detail deeplink

本 phase 不新增：

- anomaly detail route
- operator resolve / ack action
- raw sink payload viewer

### Navigation Decision

- `Safety/Authz` 必须变成产品内显式可达页面
- 这轮直接在 panel 左侧菜单补 `安全与授权` 入口
- 未来 `Phase 8-9` 再继续按已落地 domain 补齐剩余 observability 菜单项

## Execution Slices

### Slice 1: Route And Navigation Cutover

- 新建真实 `SafetyPage`
- `app.tsx` 中的 `/observability/safety` 从 delayed shell 切到真实页面
- `panel-layout.tsx` 中加入 `安全与授权` 菜单入口
- `panel-copy.ts` 中补齐 safety/authz 中文 copy

### Slice 2: Domain Helpers And Presentation Contract

- 新建 `safety-domain.ts`：
  - decision distribution presenter
  - anomaly status / severity / code copy helper
  - posture summary helper
- 固定 safety page 内部的 card / queue / detail presenter contract

### Slice 3: Summary Query Orchestration

- 页面级 summary filters：
  - `window`
  - `surface`
  - `selectedTarget`
- 使用 React Query 读取：
  - `getOperatorSafetySummary`
- 统一 loading / empty / error states

### Slice 4: Anomaly Queue And Drill-down

- 建立 anomaly queue controller：
  - cursor state
  - page / perPage
  - `severity / status / anomalyCode` filter state
- 继续通过 `listOperatorSafetyAnomalies()` 读取，不新增 fake CRUD resource
- 实现 queue table
- 实现 row detail panel
- request detail deeplink 与 sink backlinks 接入

### Slice 5: Guardrails And Regression

- 回归锁定：
  - `/observability/safety` 不再是 delayed shell
  - 菜单出现 `安全与授权` 入口
  - 页面使用 `getOperatorSafetySummary / listOperatorSafetyAnomalies`
  - 页面不直接 `fetch`
  - queue 不回退成 fake CRUD `Resource`
  - queue filters 与 summary filters 显式分离
  - 页面不假装存在 safety timeseries

### Slice 6: Verification

- package verification:
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm --dir apps/protected-panel-web test:worker`
- 增量附加验证（如果影响面扩大）：
  - `pnpm web:typecheck:affected`
  - `pnpm web:test:affected`

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-7-panel-safety-authz-domain/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-7-panel-safety-authz-domain/PLAN.md`
- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/pages/safety-page.tsx`
- `apps/protected-panel-web/src/panel/pages/safety-domain.ts`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`
- `apps/protected-panel-web/test/safety-domain.test.ts`

## Exit Rule

`Phase 7` 完成时，仓库应达到：

- `/observability/safety` 成为真正 operator safety/authz domain page
- panel 内存在显式 `安全与授权` 导航入口
- decision summary / fail-close posture / anomaly queue 能在单页稳定工作
- anomaly drill-down 与 request detail / sink backlink 能形成最小治理闭环
- 页面没有伪造 queue filters 或 safety timeseries 语义
