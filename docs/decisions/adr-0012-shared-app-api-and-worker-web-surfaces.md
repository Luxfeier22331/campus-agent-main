---
doc_type: decision
decision_id: ADR-0012
status: accepted
created: 2026-03-28
updated: 2026-03-28
---

# ADR-0012 Shared App API And Worker Web Surfaces

## 状态

Accepted on 2026-03-28.

## 背景

此前仓库已经先后冻结了两条方向：

- `public-consumer-chat` 作为独立 full-stack app boundary，拥有 auth/session/conversation
- `apps/operator-query-api` 作为独立 operator query backend

这会把 public chat 与 protected panel 继续分裂成两套产品后端。

在当前讨论下，团队更希望收敛为：

- chat 与 panel 都是部署在 Worker 上的前端表面
- 中间只有一层 shared app backend
- `apps/supervisor-api` 继续专注于 answer execution

## 决策

后续长期形态固定采用：

1. `apps/public-chat-web` 作为 public chat 的 Worker 前端。
2. `apps/protected-panel-web` 作为 protected panel 的 Worker 前端。
3. `apps/app-api` 作为 shared application backend。
4. `apps/app-api` 接管 auth、session、conversation、chat ingress、审计入口、指标记录与 operator query。
5. `apps/supervisor-api` 退为 execution engine，不再承担产品层 auth/session/conversation 或 panel 查询 API。

## 边界约束

这项决策同时冻结以下约束：

- browser 不直接调用 `apps/supervisor-api`
- panel 不直接调用数据库
- `app-api` 不是另一个 orchestrator
- `app-api` 内部仍需保持 command/query 分离
- `conversation/message` truth 不等于 operator request truth

## 结果

直接结果如下：

- 需要一份新的 canonical architecture doc 来描述 shared `app-api` 与两个 Worker web surfaces
- `apps/operator-query-api` 作为独立长期边界的设计被放弃
- `public-consumer-chat` 作为独立 full-stack app boundary 的设计被放弃
- 详细 API、数据表、auth provider、framework 和 migration 方案留给后续设计阶段
- `app-api` runtime freeze 后续由 `ADR-0013` 单独记录

## Supersedes

这项决策 supersedes 以下此前结论：

- `docs/decisions/adr-0008-public-consumer-auth-and-storage.md`
- `docs/decisions/adr-0009-public-consumer-frontend-host.md`
- `docs/decisions/adr-0011-operator-query-api-and-request-projection.md`
