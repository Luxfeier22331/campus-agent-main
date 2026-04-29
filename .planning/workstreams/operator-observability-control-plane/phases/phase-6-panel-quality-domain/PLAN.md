---
doc_type: phase_plan
phase: "6"
phase_name: "Panel Quality Domain"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 6 Plan

## Objective

把 `protected-panel-web` 的 `/observability/quality` 从 delayed shell 切成真正的 operator quality domain page。

## Why This Phase Exists

`Phase 5` 已经完成 overview substrate 与 owner cutover。下一步如果不把 `Quality` 独立落地：

- 总览页会继续承载过多质量细节
- badcase 没有 queue，无法形成治理入口
- request detail 里的 observability 只能做单请求诊断，不能承担质量域的面向队列治理

## Current Baseline

- 已具备：
  - `/observability/quality` custom route shell
  - `getOperatorQualitySummary`
  - `getOperatorQualityTimeseries`
  - `listOperatorQualityBadcases`
  - `useQueries + dataProvider + @mui/x-charts` overview substrate
  - shared sequential cursor helper
- 未具备：
  - 真正的 `QualityPage`
  - page-level quality copy / helper / presentation contract
  - badcase queue controller
  - badcase detail drill-down
  - explicit quality navigation entry

## Online Best-Practice Alignment

### React Admin

- custom domain page 继续走 `CustomRoutes`
- custom route 如果要可达，必须显式加入菜单或其他产品内导航
- 读取路径继续通过 `dataProvider` custom methods + React Query
- 官方 `ListBase` 适合 headless list；但本 phase 不把 badcase queue 重新包装成 `getList(resource)` fake CRUD 语义

### MUI X Charts

- 质量趋势图继续使用 self-contained `LineChart`
- 图表直接嵌入 Material UI cards，避免再引入第二套设计系统

## Phase 6 Product Decisions

### Page Composition

页面固定拆成五个区块：

1. 顶部 filter / as-of / 页面说明
2. runtime quality summary cards
3. quality trend charts
4. sampled grading summary
5. badcase queue + 详情 drill-down

### Runtime Summary Scope

质量页固定展示这些 runtime summary：

- request count
- empty recall rate
- citation miss rate
- refusal distribution
  - `needs_clarification`
  - `no_answer`
  - `approval_required`
  - `rejected`

### Sampled Grading Scope

质量页固定展示这些 sampled grading summary：

- grounding pass rate
- citation pass rate
- policy pass rate
- coverage rate
- open badcase count

如果 `sampledGrades === null`：

- 页面必须显式显示“采样分级尚未接通/暂无样本”
- 不得伪装成 `0`

### Trend Scope

质量页固定只做两类趋势呈现：

- runtime quality trend
  - empty recall rate
  - citation miss rate
  - needs clarification rate
  - no answer rate
- sampled grounding trend
  - `sampledGroundingPassRate`

本 phase 不追加复杂 mixed chart、secondary axis 或 sink dashboard embed。

### Badcase Queue Scope

queue 固定消费 `listOperatorQualityBadcases`

默认支持：

- cursor pagination
- `status`
- `causeClass`
- `detectedBy`

默认列至少包括：

- opened at
- summary
- cause class
- detected by
- status
- surface
- selected target
- request id

### Drill-down Scope

基础 drill-down 固定为 row-triggered detail panel：

- badcase summary
- cause class / detected by / status
- grader result / grader version / score
- request id / trace id / selected target / surface
- trace / issue backlink
- 跳转到 request detail

本 phase 不新增：

- badcase detail route
- operator resolve / ack action
- manual grading writeback

### Navigation Decision

- `Quality` 必须变成产品内显式可达页面
- 这轮直接在 panel 左侧菜单补 `质量` 入口
- 未来 `Phase 7-9` 再继续按已落地 domain 补齐其他 observability 菜单项

## Execution Slices

### Slice 1: Route And Navigation Cutover

- 新建真实 `QualityPage`
- `app.tsx` 中的 `/observability/quality` 从 delayed shell 切到真实页面
- `panel-layout.tsx` 中加入 `质量` 菜单入口
- `panel-copy.ts` 中补齐 quality domain 中文 copy

### Slice 2: Domain Helpers And Presentation Contract

- 新建 `quality-domain.ts`：
  - 质量图表 series projector
  - refusal distribution presenter
  - badcase status / cause / detectedBy copy helper
- 固定 quality page 内部的 card / chart / queue presenter contract

### Slice 3: Summary And Trend Query Orchestration

- 页面级 filters：
  - `window`
  - `surface`
  - `selectedTarget`
- 使用 React Query 读取：
  - `getOperatorQualitySummary`
  - `getOperatorQualityTimeseries`
- 统一 loading / empty / error states
- 明确 `sampledGrades === null` 的信息态，而不是零值态

### Slice 4: Badcase Queue And Drill-down

- 建立 badcase queue controller：
  - cursor state
  - page / perPage
  - `status / causeClass / detectedBy` filter state
- 继续通过 `listOperatorQualityBadcases()` 读取，不新增 fake CRUD resource
- 实现 queue table
- 实现 row detail panel
- request detail deeplink 与 sink backlinks 接入

### Slice 5: Guardrails And Regression

- 回归锁定：
  - `/observability/quality` 不再是 delayed shell
  - 菜单出现 `质量` 入口
  - 页面使用 `getOperatorQualitySummary / getOperatorQualityTimeseries / listOperatorQualityBadcases`
  - 页面不直接 `fetch`
  - queue 不回退成 fake CRUD `Resource`
  - sampled grading null-state 有显式 copy

### Slice 6: Verification

- package verification:
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm --dir apps/protected-panel-web test:worker`
- 增量附加验证（如果影响面扩大）：
  - `pnpm web:typecheck:affected`
  - `pnpm web:test:affected`

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-6-panel-quality-domain/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-6-panel-quality-domain/PLAN.md`
- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/pages/quality-page.tsx`
- `apps/protected-panel-web/src/panel/pages/quality-domain.ts`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`
- `apps/protected-panel-web/test/quality-domain.test.ts`

## Exit Rule

`Phase 6` 完成时，仓库应达到：

- `/observability/quality` 成为真正 operator quality domain page
- panel 内存在显式 `质量` 导航入口
- runtime quality summary / trend / sampled grading / badcase queue 能在单页稳定工作
- queue drill-down 与 request detail / sink backlink 能形成最小治理闭环
- `Overview` 继续只做 overview，不再继续承担 badcase queue owner
