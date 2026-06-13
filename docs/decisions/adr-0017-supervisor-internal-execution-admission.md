---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0017
status: accepted
created: 2026-03-28
updated: 2026-03-30
---
# ADR-0017 Supervisor Internal Execution Admission

## 状态

Accepted on 2026-03-28.

## Terminology Superseded

本 ADR 标题中的 `Supervisor` 是历史命名。目标态 active architecture term 是
`Execution Agent Layer`；本 ADR 的长期约束继续适用于 `execution-control` 内的
Execution Agent Layer 与 internal execution admission。

## 背景

`ADR-0012`、`ADR-0013`、`ADR-0015`、`ADR-0016` 与 `ADR-0034` 已经冻结了以下方向：

- `public-chat-web` 与 `protected-panel-web` 是两个 Worker web surface
- `apps/app-api` 是 shared application/control-plane backend
- `apps/app-api` 拥有 canonical identity / memory projection
- `apps/execution-control` 是 execution engine
- request projection 由 `apps/app-api` 拥有

但还存在四个必须继续收口的问题：

- product-layer auth/session/principal mapping 由哪一层拥有
- `apps/execution-control` 是否还应该继续承担 user-auth 语义
- request projection 应该以什么 durable truth 为 canonical source
- Better Auth、Drizzle schema 与 migration pipeline 应该如何组织

如果这些问题继续悬空，后续实现很容易再次退化为：

- `execution-control` 继续从 edge/header 恢复最终业务 actor
- request projection 先做成 queue-first 或日志重算，再回头补数据库 truth
- Better Auth 与 app-domain schema 分裂成两套 migration 世界观
- `public-chat-web`、panel 或 `execution-control` 分别长出自己的身份语义

## 决策

1. `apps/app-api` 是唯一的 product-layer identity owner。
1. `apps/app-api` 负责 auth、session、principal mapping，并显式把 `actor` 交给
   `apps/execution-control`。
1. `apps/execution-control` 只负责 internal execution caller admission，不再承担 user-auth
   语义。
1. canonical request projection 采用 database
   outbox-first：`runtime.request_execution` 与 `runtime.projection_outbox` 是第一
   durable truth，`operator.request_projection` 由 outbox 物化。
1. Better Auth runtime 落在 `apps/app-api` 内部；repo-owned auth schema 固定为
   `app_auth.*`，并显式区分 shared Postgres 上的 shared-product bootstrap owner 与
   Drizzle migration owner：`apps/app-api` bootstrap 负责 `app_auth.*` /
   `chat.*`，`drizzle.app_api_migrations` 负责 `runtime.*` / `operator.*` /
   `official_web.*`。
1. Worker runtime 的数据库访问走 Hyperdrive；schema migration 与管理动作使用 direct database
   management connection，而不是 Hyperdrive runtime binding。

## 边界约束

这项决策同时冻结以下约束：

- `apps/execution-control` 不从 Access JWT、edge header 或 browser-facing session
  恢复最终业务 actor
- `actor` 是 `app-api -> execution-control` execution contract 的显式字段，而不是 runtime
  side inference
- queue 可以在 outbox 之后作为加速或 fan-out 手段，但不是 canonical request truth
- panel 不直接消费 `runtime.request_execution`、audit log、telemetry sink 或
  `apps/execution-control`
- Better Auth adapter-owned 表仍需遵守适配器约定，但 shared DB owner 之间不得再隐式共用同一 migration
  journal

## 结果

直接结果如下：

- `apps/execution-control` 文档应从“auth”改写为“internal caller admission”
- `app-api` contract / lifecycle / schema 文档应明确 `actor` 显式传递与 outbox-first
  projection
- request projection 的第一版实现应优先采用同库 outbox + scheduled/internal consumer，而不是
  queue-first
- `apps/app-api` 实施时需要把 Better Auth runtime、shared DB ownership 与 Drizzle
  journal ownership 一并固定清楚

## Current Compatibility Note

当前仓库里的 `apps/execution-control` 仍保留 `bearer` / `trusted-worker` ingress 形态，用于
repo-local dev 和历史 runtime 兼容。

这些模式现在应被理解为：

- 当前实现的 compatibility ingress
- internal caller admission 的过渡形态

而不应再被解释为：

- forward product identity ownership
- `execution-control` 继续负责 campus end-user / operator auth 的长期依据

## Complements

这项决策 complements：

- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.
  md`
