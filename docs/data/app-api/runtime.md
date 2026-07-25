---
doc_type: data
owner_boundary: apps/app-api
status: active
---

# App API 运行时数据

## 文档边界

本文只定义 app-api 在 `runtime.*` 中拥有的数据。浏览器 turn 调度位于
`chat.turn_dispatches`；execution-control 的运行投影由 execution-control 自己管理。

## `runtime.request_observability_fact`

该表保存一次 browser request 的受控诊断摘要，用于 app-api 的质量分析和受控故障定位。
Ops Web 的主运行记录以 `chat.turn_dispatches` 和 execution-control 的 `runtime.agent_*`
为事实来源，不依赖此表重建请求旅途；该表只作为明确授权的次级关联数据。
它不是工作流状态机，也不承载原始日志、原始 prompt、模型完整输入输出、记忆正文或检索
正文。

主要字段分组：

- 关联：`request_id`、`trace_id`、`conversation_id`、`safety_identifier`；
- 请求：`surface`、principal 类型和 requested/selected tool；
- 结果：`status`、`error_code`、`semantic_outcome`、`refusal_class`、ACL 结果；
- 时序：started/completed/measured/updated 时间、总耗时和 projection lag；
- 诊断：`resolved_targets[]`、来源摘要、stage timing 和 workflow trace summary；
- 模型：provider、model、prompt id/version 和 template hash；

该表不保存 caller 请求的 scope/version query、answer eval fingerprint、LLM I/O
fingerprint、debug trace ref 或请求级观测配置。`resolved_targets_json` 是执行完成后由
服务端确认的事实，不是 app-api 输入或检索授权参数。

app-api 在接收 turn 时创建记录，在最终写入时更新同一记录。允许的状态与
`chat.turn_dispatches` 保持一致。

## 索引

当前索引服务以下受控查询：

- 时间窗口；
- status + time；
- `surface`、selected tool、principal type、model 和 safety identifier + time。

Ops Web 按 `request_id` 读取 `chat.turn_dispatches`、`chat.messages` 和
`runtime.agent_runs`，不会从此表或其他观测字段反推或改写请求状态。

## execution-control 投影

`runtime.agent_*` 由 `apps/execution-control` 的 schema installer 管理。`app_api` 角色不能读取
这些表，`ops_web` 仅获得合同列的读取权限。chat dispatch、agent run 和 observability fact
直接通过 `request_id`、`run_id` 与 `trace_id` 关联。

## 可执行来源

- `apps/app-api/src/db/schema/runtime.ts`
- `apps/app-api/src/db/schema/chat.ts`
- `apps/execution-control/internal/execution/run_projection_postgres_store.go`
- `apps/ops-web/ops/db/ops-web-database.ts`
