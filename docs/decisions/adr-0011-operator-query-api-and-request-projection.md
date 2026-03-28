---
doc_type: decision
decision_id: ADR-0011
status: superseded
created: 2026-03-28
updated: 2026-03-28
---

# ADR-0011 Operator Query API And Request Projection

Superseded on 2026-03-28 by `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`.

## 状态

Accepted on 2026-03-28.

## 背景

protected internal panel 需要查看 request-level 运行结果，但当前仓库只有 command-side answer runtime：

- `apps/supervisor-api`
- `packages/supervisor-core`
- specialist / retrieval path

如果不先冻结边界，后续实现很容易退化为以下几种腐烂方案：

- panel 直接请求 `apps/supervisor-api` 做 request list/detail 查询
- panel 直接读 raw audit logs 或 telemetry sink
- panel 直接复用 consumer chat 的 conversation/message store

这些方案都把 operator read path 和真实 answer execution 混在一起。

## 决策

operator-facing request visibility 固定采用以下形态：

1. `apps/supervisor-api` 继续只拥有 command-side answer execution。
2. command side 写入 durable request facts，并同时写入 projection outbox。
3. 独立 projector 异步构建 `request_projection` 一类 operator read model。
4. `apps/operator-query-api` 作为单独的 query-side app boundary 暴露 `GET /api/requests` 等只读接口。
5. `apps/protected-internal-panel` 只消费 `apps/operator-query-api`，不直接调用 `apps/supervisor-api` 获取 request projection。

## 同数据库约束

第一版接受 `apps/supervisor-api` 与 `apps/operator-query-api` 共用同一个关系数据库。

这里的结论是：

- 物理拆库不是当前前置条件
- 同数据库不等于同边界
- command-side facts/outbox 与 operator read model 必须逻辑分离

## 一致性约束

第一版明确接受 eventual consistency。

这意味着：

- request projection 可以异步出现
- panel 不需要通过同步查询 answer runtime 来追求零延迟
- operator read path 应优先保证边界正确，而不是把读写强行压成一条同步链路

## 不接受的方案

以下方案被明确排除：

- `apps/supervisor-api` 同时承担 `GET /api/requests`
- panel 直连数据库
- 以 consumer chat 的 conversation/message store 作为 operator request truth
- 以 audit JSONL、Axiom、Sentry 或其他 telemetry sink 作为 panel canonical source

## 结果

这项决策的直接结果是：

- 需要一份独立的 request projection architecture canonical doc
- protected panel 相关文档必须改写为 `panel -> apps/operator-query-api -> request_projection`
- 后续实现应新增 query-side app boundary，而不是扩建 answer runtime
