---
doc_type: decision
decision_id: ADR-0015
status: accepted
created: 2026-03-28
updated: 2026-03-28
---

# ADR-0015 Supervisor Internal Execution Admission

## 状态

Accepted on 2026-03-28.

## 背景

`ADR-0012`、`ADR-0013` 与 `ADR-0014` 已经冻结了以下方向：

- `public-chat-web` 与 `protected-panel-web` 是两个 Worker web surface
- `apps/app-api` 是 shared product backend
- `apps/supervisor-api` 是 execution engine
- request projection 由 `apps/app-api` 拥有

但还存在四个必须继续收口的问题：

- product-layer auth/session/principal mapping 由哪一层拥有
- `apps/supervisor-api` 是否还应该继续承担 user-auth 语义
- request projection 应该以什么 durable truth 为 canonical source
- Better Auth、Drizzle schema 与 migration pipeline 应该如何组织

如果这些问题继续悬空，后续实现很容易再次退化为：

- `supervisor-api` 继续从 edge/header 恢复最终业务 actor
- request projection 先做成 queue-first 或日志重算，再回头补数据库 truth
- Better Auth 与 app-domain schema 分裂成两套 migration 世界观
- `public-chat-web`、panel 或 `supervisor-api` 分别长出自己的身份语义

## 决策

1. `apps/app-api` 是唯一的 product-layer identity owner。
2. `apps/app-api` 负责 auth、session、principal mapping，并显式把 `actor` 交给 `apps/supervisor-api`。
3. `apps/supervisor-api` 只负责 internal execution caller admission，不再承担 user-auth 语义。
4. canonical request projection 采用 database outbox-first：`runtime.request_execution` 与 `runtime.projection_outbox` 是第一 durable truth，`operator.request_projection` 由 outbox 物化。
5. Better Auth 落在 `apps/app-api` 内部；`auth.*`、`chat.*`、`runtime.*`、`operator.*` 共享一套 Drizzle schema codebase 与一条 migration pipeline。
6. Worker runtime 的数据库访问走 Hyperdrive；schema migration 与管理动作使用 direct database management connection，而不是 Hyperdrive runtime binding。

## 边界约束

这项决策同时冻结以下约束：

- `apps/supervisor-api` 不从 Access JWT、edge header 或 browser-facing session 恢复最终业务 actor
- `actor` 是 `app-api -> supervisor-api` execution contract 的显式字段，而不是 runtime side inference
- queue 可以在 outbox 之后作为加速或 fan-out 手段，但不是 canonical request truth
- panel 不直接消费 `runtime.request_execution`、audit log、telemetry sink 或 `apps/supervisor-api`
- Better Auth adapter-owned 表仍需遵守适配器约定，但不能因此拆出第二条 migration pipeline

## 结果

直接结果如下：

- `apps/supervisor-api` 文档应从“auth”改写为“internal caller admission”
- `app-api` contract / lifecycle / schema 文档应明确 `actor` 显式传递与 outbox-first projection
- request projection 的第一版实现应优先采用同库 outbox + scheduled/internal consumer，而不是 queue-first
- `apps/app-api` 实施时需要把 Better Auth、Drizzle schema 与 migration tooling 视为一个统一 backend baseline

## Current Compatibility Note

当前仓库里的 `apps/supervisor-api` 仍保留 `bearer` / `trusted-worker` ingress 形态，用于 repo-local dev 和历史 runtime 兼容。

这些模式现在应被理解为：

- 当前实现的 compatibility ingress
- internal caller admission 的过渡形态

而不应再被解释为：

- forward product identity ownership
- `supervisor-api` 继续负责 public user / operator user auth 的长期依据

## Complements

这项决策 complements：

- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0014-app-api-request-projection-and-panel-query-ownership.md`
