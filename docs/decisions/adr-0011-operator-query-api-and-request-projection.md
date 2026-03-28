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

## 历史结论

这个 ADR 记录了一个已经被放弃的中间方案：

1. `apps/supervisor-api` 继续只拥有 command-side answer execution。
2. command side 写入 durable request facts，并同时写入 projection outbox。
3. 独立 projector 异步构建 `request_projection` 一类 operator read model。
4. `apps/operator-query-api` 作为单独的 query-side app boundary 暴露 `GET /api/requests` 等只读接口。
5. `apps/protected-internal-panel` 只消费 `apps/operator-query-api`。

## 仍然保留的价值

虽然 `apps/operator-query-api` 这条 split-backend 路径被放弃，但以下判断仍然成立：

- command/query 必须逻辑分离
- eventual consistency 是可接受的
- panel 不得直连数据库
- panel 不得把 consumer chat store、audit JSONL 或 telemetry sink 当作 canonical request truth

## 被替代的部分

以下结论已被后续 ADR 替代：

- `apps/operator-query-api` 作为独立长期边界
- `apps/protected-internal-panel` 作为 forward canonical panel surface

forward truth 现由以下文档记录：

- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0014-app-api-request-projection-and-panel-query-ownership.md`
