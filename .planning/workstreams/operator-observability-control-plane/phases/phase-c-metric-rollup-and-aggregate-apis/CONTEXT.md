---
phase: "C"
name: "Metric Rollup And Aggregate APIs"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase C Context

## Goal

在不重跑已被 merged truth 吸收的 `Phase A-B` 的前提下，收口 `apps/app-api` operator aggregate contract 与实现之间的 residual gap，并冻结 `protected-panel-web` 后续扩面所需的 same-site BFF namespace。

## Current Truth

- 这条 workstream 已从 deferred 恢复为 active，但旧 roadmap 仍是假定从后端基础阶段重新开始。
- 当前 merged truth 已具备：
  - `runtime.request_observability_fact`
  - request observability detail
  - operator `overview / quality / safety / cost / audit` 的大部分 app-api query route
  - `qualityGradeProjection` 与 internal grade ingest seam
  - request detail 中的 trace backlink 与 `auditSummary`
- 当前仍未闭合的真相：
  - `docs/contracts/app-api-operator-observability-http.md` 冻结了 `GET /api/operator/safety/anomalies` 与 `GET /api/operator/cost/timeseries`
  - `apps/app-api/src/app.ts` 目前只实现了 `safety/summary` 与 `cost/summary`
  - `protected-panel-web` 只有壳层 `/api/overview`、`/api/requests*`、`/api/official-web/*`
  - panel 当前 `/api/overview` 被 `auth-provider` 与 Overview 页面复用，返回的是壳层/runtime summary，不是 operator aggregate snapshot
  - panel 还没有 `Quality / Safety/Authz / Cost / Audit` 的 data provider、types、resource/page rollout

## Why This Phase Exists

如果现在直接冲进 panel 新域，会立刻遇到两个结构性问题：

- panel 缺少稳定、闭合的 aggregate API 真相，最终只能围绕缺口做 page-level patch
- 现有 `/api/overview` seam 已被壳层和认证链路占用，不能再静默塞入 operator aggregate payload

所以这条线必须先在 `Phase C` 把 app-owned backend contract 与 panel BFF namespace 收口，再进入 `Phase D` 的 UI/domain rollout。

## Locked Decisions

### Ordering Decision

- workstream 仍严格按 `A -> B -> C -> D -> E -> F` 推进。
- 本次恢复从 `Phase C` 开始，不重跑 `Phase A-B`。

### Ownership Decision

- `apps/app-api` 继续是 operator observability aggregate read-model owner。
- `protected-panel-web` 继续只消费 same-site BFF，再由 BFF 代理到 `app-api`。

### Route Decision

- 不重用当前壳层 `/api/overview` 作为 operator aggregate overview seam。
- `Phase C` 需要冻结一条独立的 panel-local operator-observability namespace，供 `Phase D` 直接消费。

### Anti-Shortcut Decision

- 不允许 panel 直接读 `Sentry`、`Axiom`、raw audit log 或 `apps/supervisor-api` 来绕过 aggregate gap。
- contract 与代码不一致时，优先收口 backend truth，不接受在 panel 侧堆兼容逻辑。

## Existing Code Insights

### Relevant Backend Files

- `apps/app-api/src/app.ts`
- `apps/app-api/src/modules/operator-query/service.ts`
- `apps/app-api/src/modules/operator-query/store.ts`
- `apps/app-api/src/db/schema/operator.ts`
- `apps/app-api/test/operator-query.route.test.ts`
- `apps/app-api/test/operator-observability-shared-db.integration.test.ts`

### Relevant Panel Files

- `apps/protected-panel-web/src/index.ts`
- `apps/protected-panel-web/src/panel/auth-provider.ts`
- `apps/protected-panel-web/src/panel/data-provider.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page.tsx`
- `apps/protected-panel-web/test/worker.test.ts`

## Non-goals

- 在本 phase 内直接交付 `Quality / Safety/Authz / Cost / Audit` 最终 UI
- 重做 panel 现有 `Requests` triage table
- 打开 `Jobs` / `Operations`
- 新增 operator 写 API 或 incident workflow

## Canonical References

- `docs/architecture/current-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/operator-observability-architecture.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/plans/archive/completed/operator-observability-control-plane-foundation.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/operator-observability-control-plane/REQUIREMENTS.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
