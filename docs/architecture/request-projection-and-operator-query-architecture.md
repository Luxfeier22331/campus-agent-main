---
doc_type: architecture
status: superseded
created: 2026-03-28
updated: 2026-03-28
---

# Request Projection And Operator Query Architecture

> Superseded on 2026-03-28 by `docs/architecture/shared-app-api-and-worker-web-surfaces.md` and `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`.
> 
> This file records the intermediate direction where request projection was served by a dedicated `apps/operator-query-api`. The accepted direction now folds that responsibility into shared `apps/app-api` while keeping command/query separation internally.

## 保留原因

保留这份文档只是为了记录一个已经被放弃的中间方向：

- 当时曾考虑把 operator query 做成独立 `apps/operator-query-api`
- 当时 panel 也仍使用旧命名 `apps/protected-internal-panel`

这些都不再是 forward truth。

## 仍然有效的部分

虽然 split-backend 方向被放弃，但以下判断仍然有效，并已进入新文档：

- request truth 必须保持 command/query 分离
- panel 不能直连数据库
- panel 不能直连 `apps/supervisor-api`
- panel 不能把 consumer chat store、JSONL audit 或 telemetry sink 当成 canonical request truth
- `runtime.request_execution`、`runtime.projection_outbox` 与 `operator.request_projection` 应逻辑分离

## 已被新文档替代的部分

以下表述都已过时：

- `apps/operator-query-api` 作为独立长期 app boundary
- `apps/protected-internal-panel -> apps/operator-query-api -> request_projection`
- `apps/supervisor-api` 与 `apps/operator-query-api` 并列共享一个产品后端职责面

forward truth 现为：

- `public-chat-web`
- `protected-panel-web`
- shared `app-api`
- `supervisor-api` execution engine

## Forward Docs

- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/request-projection-and-runtime-read-model.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/data/app-api-schema.md`
