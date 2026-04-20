---
doc_type: plan
status: active
created: 2026-04-02
updated: 2026-04-20
---

# Operator Observability Control-Plane Foundation

## 文档边界

本文固定 `operator observability / control-plane` 这条单一 active workstream 的前向范围：

- `apps/app-api` owned request-scoped observability fact
- app-owned audit projection、quality/safety/cost rollup 与 operator APIs
- `protected-panel-web` 的 `Overview / Requests / Quality / Safety/Authz / Cost / Audit` 扩面
- `Sentry` / `Axiom` / sampled grading 的 sink participation 与 app-owned 回流

它不负责：

- 改写 `docs/architecture/operator-observability-architecture.md` 的长期边界
- 改写 `ADR-0023` 的 ownership / sink participation 决策
- 把 panel 退化成 raw sink explorer、trace console 或数据库查询台
- 把 `shared product surfaces acceptance / hardening` 混成同一条 workstream

## Lifecycle Contract

- 文档 lifecycle 保持 `active`
- exact active wave、剩余 blocker 与已完成切片只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`
- 本文只保留固定 phase order、implementation contract 与 residual gap 类型

## Execution Contract

这条线始终按一条 workstream 推进：

1. request-scoped observability foundation
2. audit projection
3. metric rollup and aggregate APIs
4. panel domain expansion
5. sink participation and grading backflow
6. planning closeout

固定原因：

- request fact、aggregate API、panel 新域与 sink participation 共享同一 app-owned operator truth
- 如拆成多条 lane，容易让 panel 回退成 sink viewer，或让 read model 永远停在半开状态

## Current Baseline

当前 merged truth 已吸收的部分：

- `apps/app-api` 已具备 request observability fact、detail seam 与大部分 aggregate query route
- `quality_grade_projection` 与 internal ingest seam 已存在
- `protected-panel-web` 已在 `Requests` detail 消费 request observability summary、trace backlink 与 `auditSummary`

当前 residual gap 继续限定为：

- `app-api` operator contract 与 route truth 尚未完全闭合
- panel `Quality / Safety/Authz / Cost / Audit` 仍未完整 rollout
- `Sentry` / `Axiom` / sampled grading` 的回流仍需继续 productize

## Fixed Rules

- `apps/app-api` 持续是 operator-facing observability read-model owner
- panel 不得绕回 raw audit log、telemetry sink 或 `apps/supervisor-api`
- `Sentry`、`Axiom`、grading/eval` 只作为 sink 或回流输入，不得直接成为 panel canonical truth
- `Requests` 当前开放域的稳定化仍属于 `shared product surfaces`
- 只有当目标扩成 `Overview / Quality / Safety/Authz / Cost / Audit` 时，才属于本文

## Forward Phases

### Phase A: Request-Scoped Observability Foundation

目标：

- 固定 request fact、trace correlation、cost / retrieval / citation / deny summary 的 canonical write path

退出条件：

- request identity 与 `request_id` / `trace_id` 对齐
- raw prompt、raw answer、raw auth material 不进入 observability fact

### Phase B: Audit Projection

目标：

- 提供 app-owned curated audit timeline

退出条件：

- panel `Audit` 未来消费的是 curated audit projection
- 不是 raw JSONL replay 或 sink side backdoor

### Phase C: Metric Rollup And Aggregate APIs

目标：

- 收口 `Overview / Quality / Safety / Cost / Audit` aggregate family

优先 API：

- `GET /api/operator/overview`
- `GET /api/operator/quality/summary`
- `GET /api/operator/quality/timeseries`
- `GET /api/operator/safety/summary`
- `GET /api/operator/safety/anomalies`
- `GET /api/operator/cost/summary`
- `GET /api/operator/cost/timeseries`
- `GET /api/operator/audit`
- `GET /api/operator/audit/:id`

退出条件：

- contract 与 route truth 对齐
- panel 不需向 sink 直接发查询

### Phase D: Panel Domain Expansion

目标：

- 让 `protected-panel-web` 依次恢复 `Overview / Quality / Safety/Authz / Cost / Audit`

退出条件：

- same-site BFF / data-provider / page rollout 成立
- `/api/overview` 壳层 summary 不被误当 operator aggregate overview

### Phase E: Sink Participation And Grading Backflow

目标：

- 把 `Sentry`、`Axiom`、sampled grading` 从旁路 sink 收口为 app-owned backflow input

退出条件：

- sink participation 有稳定回流 contract
- panel 仍只消费 app-owned truth

### Phase F: Planning Closeout

目标：

- 把当前 operator control-plane 真相、已开放域与 residual deferred items 写回 planning

退出条件：

- `.planning` 与 docs 对齐
- operator observability 不再存在“半开 domain”描述漂移
