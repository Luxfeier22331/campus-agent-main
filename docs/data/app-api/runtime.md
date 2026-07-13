---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-12
---

# App API Runtime Schema

## 文档边界

本文只定义 app-api 在 `runtime.*` 中拥有的数据。浏览器 turn 调度位于
`chat.turn_dispatches`；execution-control 的运行投影由 execution-control 自己管理。

## `runtime.request_observability_fact`

该表保存一次 browser request 的受控诊断摘要，用于 Ops Web 关联、质量分析和故障定位。
它不是工作流状态机，也不承载原始日志、原始 prompt、模型完整输入输出、记忆正文或检索
正文。

主要字段分组：

- 关联：`request_id`、`trace_id`、`conversation_id`、`safety_identifier`；
- 请求：`surface`、principal 类型、requested/selected tool、scope 和 version query 摘要；
- 结果：`status`、`error_code`、`semantic_outcome`、`refusal_class`、ACL 结果；
- 时序：started/completed/measured/updated 时间、总耗时和 projection lag；
- 诊断：来源摘要、stage timing 和 workflow trace summary；
- 模型：provider、model、prompt id/version 和 template hash；
- 评测：answer eval 与 LLM I/O fingerprint。

app-api 在接收 turn 时创建记录，在最终写入时更新同一记录。允许的状态与
`chat.turn_dispatches` 保持一致。

## 索引

当前索引服务以下受控查询：

- 时间窗口；
- status + time；
- surface、selected tool、principal type、model 和 safety identifier + time。

Ops Web 按 `request_id` 联合该表与 `chat.turn_dispatches`、`chat.messages`、
`runtime.agent_runs`，不会从 observability 字段反推或改写请求状态。

## 不属于 app-api 的 runtime 表

`runtime.agent_runs`、event/step/tool/memory/closeout 投影由
`apps/execution-control` 的 schema installer 管理。`app_api` 角色不能读取这些表；
`ops_web` 仅获得合同列的读取权限。

以下表已经退役，不得恢复：

- `runtime.request_execution`
- `runtime.projection_outbox`

当前请求关联不需要 projector：chat dispatch、agent run 和 observability fact 通过
`request_id`、`run_id`、`trace_id` 直接关联。

## 可执行来源

- `apps/app-api/src/db/schema/runtime.ts`
- `apps/app-api/src/db/schema/chat.ts`
- `apps/execution-control/internal/execution/run_projection_postgres_store.go`
- `apps/app-api/ops/db/ops-web-database.ts`
