---
doc_type: phase_plan
phase: "9"
phase_name: "Panel Audit Domain"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 9 Plan

## Objective

把 `protected-panel-web` 的 `/observability/audit` 从 delayed shell 切成真正的 operator `Audit` domain page。

## Why This Phase Exists

`Phase 5-8` 已完成 overview / quality / safety / cost owner cutover。下一步如果不把 `Audit` 独立落地：

- observability control plane 仍会残留一个壳层域
- operator 无法在 panel 中完成 request-scoped audit timeline drill-down
- dev/staging smoke 仍不能对 observability 域做完整验收

## Current Baseline

- 已具备：
  - `/observability/audit` custom route shell
  - `listOperatorAudit`
  - `getOperatorAuditEvent`
  - `useDataProvider` + React Query
  - table + drawer 的现成交互模式
- 未具备：
  - 真正的 `AuditPage`
  - audit 中文 copy / helper / presenter contract
  - `审计` 菜单到 canonical route 的收口
  - list/detail regression coverage

## Online Best-Practice Alignment

### React Admin

- custom domain page 继续走 `CustomRoutes`
- custom route 不会自动出现在菜单里，因此菜单必须显式指向 `/observability/audit`
- 读取路径继续通过 `dataProvider` custom methods + React Query
- 本 phase 不把 audit page 退回 fake CRUD `Resource`

### Contract-Driven UI

- `listOperatorAudit` / `getOperatorAuditEvent` 已经是当前真实 contract
- 当前 contract 没有 audit aggregate summary、export、ack 写操作
- 页面不应伪造这些不存在的 owner 语义

## Phase 9 Product Decisions

### Page Composition

页面固定拆成三层：

1. 顶部 page intro / filter bar / 当前筛选
2. audit timeline table
3. row-triggered detail drawer

### Timeline Scope

timeline table 固定展示这些字段：

- `occurredAt`
- `eventType`
- `summary`
- `requestId`
- `status`
- `surface`
- `principalType`
- `selectedTarget`

必要时允许追加只读辅助动作：

- 查看详情
- 打开请求详情

### Detail Scope

drawer 固定展示：

- `requestId`
- `traceId`
- `occurredAt`
- `eventType`
- `status`
- `terminalCode`
- `principalType`
- `requestedCapability`
- `selectedTarget`
- `entitlementSnapshotId`
- `policyProjectionVersion`
- `diagnostics.failClosed`
- `diagnostics.aclAnomalyCode`
- `diagnostics.sourceDocIds`
- `links.traceLink / issueLink / issueFingerprint`

### Filter Scope

本 phase 默认只开放 contract 已冻结的 filters：

- `requestId`
- `traceId`
- `principalType`
- `surface`
- `selectedTarget`
- `eventType`
- `status`

本 phase 默认不开放：

- `window`
- `collection`
- `modelName`
- `requestedCapability`
- 手工 `cursor`

### Anti-Fake-Summary Decision

本 phase 不新增：

- audit KPI cards
- export/download action
- raw payload tab
- sink passthrough query

因为这些都不在当前 contract 中。

### Navigation Decision

- `审计` 菜单必须切到 `/observability/audit`
- `/observability/audit` 必须成为唯一 canonical owner
- 旧 `/audit` 如继续存在，只能回 canonical route，不能继续保留另一个 delayed domain

## Execution Slices

### Slice 1: Planning And Guardrails

- 新建 `phase-9-panel-audit-domain/CONTEXT.md`
- 新建 `phase-9-panel-audit-domain/PLAN.md`
- 明确：
  - canonical route
  - filter family
  - curated timeline posture
  - detail drawer posture

### Slice 2: Red Tests

- 新增 `audit-domain` helper tests
- 新增 raw-source regression：
  - `/observability/audit` 不再是 delayed shell
  - 菜单 `审计` 指向 canonical route
  - page 使用 `listOperatorAudit / getOperatorAuditEvent`
  - page 不直接 `fetch`
  - page 不退回 fake CRUD/resource
- 补 `dataProvider.listOperatorAudit()` filter / pagination 映射测试

### Slice 3: Route And Navigation Cutover

- 新建真实 `AuditPage`
- `app.tsx` 中的 `/observability/audit` 从 delayed shell 切到真实页面
- `panel-layout.tsx` 中把 `审计` 菜单改到 canonical route
- `panel-copy.ts` 中补齐 audit 中文 copy

### Slice 4: Domain Helpers And Page Owner

- 新建 `audit-domain.ts`
  - 事件类型格式化
  - 状态格式化
  - 诊断与详情字段 presenter helper
- 固定 audit page 内部的 timeline/detail presenter contract

### Slice 5: Query Orchestration And Rendering

- 页面用 `useQuery` 驱动：
  - `listOperatorAudit`
  - `getOperatorAuditEvent`
- 固定 list filters、分页、error/empty/loading states
- 渲染 timeline table
- 渲染 detail drawer 与 backlink

### Slice 6: Verification And GSD Closeout

- package verification:
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm --dir apps/protected-panel-web test:worker`
- phase artifact closeout:
  - `SUMMARY.md`
  - `ROADMAP.md`
  - `STATE.md`

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/phases/phase-9-panel-audit-domain/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-9-panel-audit-domain/PLAN.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-9-panel-audit-domain/SUMMARY.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `apps/protected-panel-web/src/panel/app.tsx`
- `apps/protected-panel-web/src/panel/panel-layout.tsx`
- `apps/protected-panel-web/src/panel/panel-copy.ts`
- `apps/protected-panel-web/src/panel/pages/audit-domain.ts`
- `apps/protected-panel-web/src/panel/pages/audit-page.tsx`
- `apps/protected-panel-web/test/data-provider.test.ts`
- `apps/protected-panel-web/test/panel-shell-copy-regression.test.ts`
- `apps/protected-panel-web/test/effect-loading-regression.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`
- `apps/protected-panel-web/test/audit-domain.test.ts`

## Exit Rule

只有在以下条件同时成立时，`Phase 9` 才算完成：

- `/observability/audit` 已切成真实 domain page
- 左侧菜单中的 `审计` 已指向 canonical route
- 页面稳定消费 `listOperatorAudit / getOperatorAuditEvent`
- 已具备 timeline + detail drawer + backlink 三类展示
- 已有 regression tests 锁定不回退到 delayed shell / fake resource / raw log viewer
- `pnpm --dir apps/protected-panel-web typecheck`
- `pnpm --dir apps/protected-panel-web test:worker`
