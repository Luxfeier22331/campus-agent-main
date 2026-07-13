---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-12
---

# App API Operator HTTP

## 范围

本文列出 app-api 当前 operator source-processing 读取面。Operator Console 当前不消费这些
页面；数据库表存在也不自动开放 route。

## Authenticated Notice

- `GET /api/operator/authenticated-notices/processing`
- `GET /api/operator/authenticated-notices/processing/:noticeId`
- `GET /api/operator/authenticated-notices/run-processing`
- `GET /api/operator/authenticated-notices/run-processing/:id`

list 支持受限 limit/cursor 和代码中声明的 filter；detail 返回 sanitized projection 与
timeline。响应不包含原始通知正文、认证材料或 Temporal history。

## Official Web

- `GET /api/operator/official-web/release-tasks`
- `GET /api/operator/official-web/release-tasks/:id`

返回 release task lifecycle、输入/输出摘要、错误和 timeline，不返回 raw artifact bytes。

## Ingestion

- `GET /api/operator/ingestion/tasks`

该 route 读取 ingestion-control owner 的 operator-safe task projection，不创建或修改任务。

## 已退役

app-api 不再暴露：

- `/api/operator/requests`
- `/api/operator/requests/:requestId`
- `/api/operator/runtime/*`
- execution audit ingest/backflow routes

请求排查由 self-hosted Ops Web 直接读取受限 PostgreSQL 列并关联 execution-control 数据。

## 通用规则

- 只接受 operator-via-panel 或明确 trusted operator principal；
- limit/cursor/filter 验证失败返回统一 app-api error envelope；
- 未找到 detail 返回 `404`；
- 不返回数据库 owner 字段、raw auth、raw prompt、raw answer 或 provider payload。

## 可执行来源

- `apps/app-api/src/app/routes/operator.ts`
- `apps/app-api/src/app/route-exposure-operator-inventory.ts`
- `apps/app-api/src/db/schema/operator.ts`
