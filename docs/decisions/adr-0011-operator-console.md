---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0011
status: superseded
superseded_by: ADR-0080
---
# ADR-0011 Operator Console Worker 边界（已取代）

## 背景

供应商配置和部分业务操作需要受保护的浏览器界面，但不需要直接访问内部运行数据，也
不需要第二个应用后端。

## 历史决策

`apps/operator-console-web` 是 Cloudflare Worker 应用。它提供运维浏览器 shell，并且只
代理明确 allowlist 中的 `apps/app-api` operator route。

Cloudflare Access 是外层保护。Worker 仍需在 origin 校验 Access assertion 和应用
allowlist；网络保护不能替代 operator authorization。

Worker 不查询 PostgreSQL、execution-control、Temporal、Qdrant 或可观测性 sink。深入的
请求和运行时诊断属于 ADR-0072 接受的自托管 Ops Web。

本决策不固定前端或 Worker framework。早期提出的 `react-admin` 和 Hono 没有实现，现已
撤回。只要安全和所有权边界不变，当前 React/Radix/TanStack UI 和原生 Worker handler
可以不经 ADR 演进。

## 取代

ADR-0080 删除 Operator Console Worker，将模型配置、运行排查和已准入领域操作统一到自托管
Ops Web。本文只保留历史背景，不再指导实现。

## 相关文档

- `docs/architecture/system/product-runtime.md`
- `docs/decisions/adr-0080-ops-web.md`
