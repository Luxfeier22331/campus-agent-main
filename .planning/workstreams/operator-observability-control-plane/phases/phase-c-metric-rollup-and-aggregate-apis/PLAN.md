---
doc_type: phase_plan
phase: "C"
phase_name: "Metric Rollup And Aggregate APIs"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase C Plan

## Objective

把 `apps/app-api` operator observability aggregate surfaces 从“已大体存在但 contract/route truth 未完全闭合”收口为 `Phase D` 可直接消费的稳定后端，并冻结 panel-local same-site BFF namespace。

## Why This Phase Exists

这条线的当前风险不是 owner 没定，而是 execution truth 半开：

- app-api 已有 `overview / quality / safety / cost / audit` 的大部分只读能力
- contract 仍声明了 `safety/anomalies` 与 `cost/timeseries`
- panel 还没有对应 same-site BFF 与 page rollout
- 当前 `/api/overview` 又已经承担壳层与认证探针职责

如果不先把这些 gap 收口，后续 `Phase D` 只能围绕旧 seam 做 patch，而不是在正确边界上扩面。

## Current Baseline

- 已落地：
  - `GET /api/operator/overview`
  - `GET /api/operator/quality/summary`
  - `GET /api/operator/quality/timeseries`
  - `GET /api/operator/quality/badcases`
  - `GET /api/operator/safety/summary`
  - `GET /api/operator/cost/summary`
  - `GET /api/operator/audit`
  - `GET /api/operator/audit/:auditEventId`
  - `GET /api/operator/requests/:requestId/observability`
- 当前 residual gap：
  - `GET /api/operator/safety/anomalies`
  - `GET /api/operator/cost/timeseries`
  - panel-local observability namespace 尚未冻结

## Execution Slices

### Slice 1: Rebase Planning Truth On Current Code

- 更新 workstream `REQUIREMENTS.md`、`ROADMAP.md`、`STATE.md`
- 把 `Phase A-B` 标记为已被 merged truth 吸收
- 把当前执行起点固定为 `Phase C`

### Slice 2: Close Aggregate API Contract Gaps In `app-api`

- 对照 `docs/contracts/app-api-operator-observability-http.md` 与当前实现，逐项核对 operator aggregate endpoints
- 在 `apps/app-api` 内补齐：
  - `GET /api/operator/safety/anomalies`
  - `GET /api/operator/cost/timeseries`
- 如发现现有 summary/timeseries filter normalization、response shape 或 error model 与 contract 漂移，一并收口在本 phase 内
- 继续保持 `app-api` 是唯一 aggregate owner，不把 gap 甩给 panel 侧 workaround

### Slice 3: Freeze Panel-Local Same-Site Namespace For Phase D

- 保留当前壳层 `/api/overview`，继续服务：
  - auth-provider
  - shell/runtime summary
- 为后续 operator observability domains 冻结独立 same-site namespace：
  - `GET /api/operator/overview`
  - `GET /api/operator/quality/summary`
  - `GET /api/operator/quality/timeseries`
  - `GET /api/operator/quality/badcases`
  - `GET /api/operator/safety/summary`
  - `GET /api/operator/safety/anomalies`
  - `GET /api/operator/cost/summary`
  - `GET /api/operator/cost/timeseries`
  - `GET /api/operator/audit`
  - `GET /api/operator/audit/:auditEventId`
- `Phase C` 至少要把这条 namespace 与 worker proxy strategy 明确冻结到 planning truth，避免 `Phase D` 再为路由命名返工

### Slice 4: Verification And Exit Gate

- backend verification:
  - `pnpm --dir apps/app-api typecheck`
  - `pnpm --dir apps/app-api test:node`
  - `pnpm --dir apps/app-api test:shared-db-integration`
- repo-level verification when touched scope crosses app boundaries:
  - `pnpm web:typecheck:affected`
  - `pnpm web:test:affected`
  - `pnpm web:test:integration`
- planning verification:
  - workstream active status 与 current phase 指向 `Phase C`
  - canonical plan 与 domain index 不再把这条线写成 deferred

## Proposed Write Set

- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/operator-observability-control-plane/REQUIREMENTS.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-c-metric-rollup-and-aggregate-apis/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-c-metric-rollup-and-aggregate-apis/PLAN.md`
- `docs/plans/operator-observability-control-plane-foundation.md`
- `docs/domains/operator-observability.md`
- `apps/app-api/src/app.ts`
- `apps/app-api/src/modules/operator-query/service.ts`
- `apps/app-api/src/modules/operator-query/store.ts`
- `apps/app-api/test/operator-query.route.test.ts`
- `apps/app-api/test/operator-observability-shared-db.integration.test.ts`
- `apps/protected-panel-web/src/index.ts`
- `apps/protected-panel-web/test/worker.test.ts`

## Exit Rule

`Phase C` 完成时，仓库应达到：

- operator observability contract 与 `app-api` aggregate route truth 已对齐
- `safety/anomalies` 与 `cost/timeseries` 不再停留在 contract-only 状态
- `Phase D` 可直接基于已冻结的 panel-local `/api/operator/*` namespace 推进 panel domain rollout
- planning truth 不再把这条 workstream 误写为 deferred，也不再假装必须从 `Phase A` 重做
