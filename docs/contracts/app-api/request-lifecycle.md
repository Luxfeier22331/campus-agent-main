---
doc_type: contract
truth_scope: app_api
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-12
---

# Chat Request Lifecycle

## 文档边界

本文定义 `POST /api/chat/requests` 和 stream 变体从接收 turn 到最终消息写入的持久化与
幂等规则。execution-control 的 Temporal workflow、事件合同和内部步骤不在本文重复定义。

## 权威数据

- `chat.conversations` 和 `chat.messages` 保存用户可见会话。
- `chat.turn_dispatches` 保存一次 turn 的 admission、关联标识、幂等键和最终状态。
- `runtime.request_observability_fact` 保存受控诊断摘要。
- execution-control 使用同一个 `run_id` 在 `runtime.agent_*` 中保存 workflow projection。
- Temporal 保存完整 workflow history。

`runtime.request_execution`、`runtime.projection_outbox` 和 operator request projector 已退役。

## 状态

`chat.turn_dispatches.status` 允许：

- `accepted`
- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`
- `cancelled`

只有 `accepted` 可以原子推进到终态。队列和执行中的细粒度状态来自 durable run event，
不写入 turn dispatch 状态列。

## 接收事务

app-api 完成身份、授权、输入和幂等检查后，在同一事务内：

1. 创建或确认 conversation；
2. 写入 user message；
3. 写入 `chat.turn_dispatches(status=accepted)`；
4. 写入 accepted observability fact；
5. 推进 conversation active turn/run 指针。

事务提交后才调用 execution-control 创建 durable run。创建失败或请求被限流时，app-api
通过同一 finalization 规则收口，不能留下无法解释的 accepted turn。

## Durable Run

app-api 向 execution-control 发送 `request_id`、`run_id`、`trace_id`、conversation context、
principal/authorization 和显式 tool/scope 请求。三组关联标识必须在后续事件中保持一致；
不一致的事件以验证错误拒绝。

stream 请求先发送 `request.accepted`，随后转发受类型约束的 run/answer 事件。客户端断开会
触发取消路径，但数据库终态仍由 durable run 事件和 finalization 决定。

## 最终事务

收到 terminal event 后，app-api 在同一事务内：

1. 将目标 turn dispatch 从 `accepted` 更新为终态；
2. 写入 assistant message 和 structured parts；
3. 更新 observability fact；
4. 仅当该 run 仍是 active run 时推进 conversation branch/head；
5. 仅在 `completed` 时写入明确确认的 session slots。

同一个 request 不能再次终结。较旧分支完成时可以保存自己的结果，但不能覆盖更新的 active
branch/head。

## 幂等

- 非空幂等键以 `(actor_user_id, idempotency_key)` 唯一。
- 同一键和同一 request fingerprint 返回已有结果或已有 accepted 状态。
- 同一键对应不同 fingerprint 时返回冲突，不创建第二个 turn。
- 没有幂等键时不提供跨请求 deduplication。

## Ops Web 关联

Ops Web 以 `chat.turn_dispatches` 为 request 列表起点，按 `run_id` 左连接
`runtime.agent_runs`，按 `request_id` 左连接 `runtime.request_observability_fact`，并通过
`user_message_id` 读取 `chat.messages` 的问题摘要。它不需要 app-api projector，也不通过
operator console 读取。

## 失败边界

- 缺少数据库、execution-control、合同或授权时失败关闭。
- 不使用内存队列、JSONL、telemetry 或 chat transcript 重建 durable status。
- 不允许静默 fallback 到同步 mega-agent、旧 supervisor 或 flat retrieval path。

## 可执行来源

- `apps/app-api/src/modules/runtime-command/`
- `apps/app-api/src/modules/runtime-run/`
- `apps/app-api/src/db/schema/chat.ts`
- `apps/app-api/src/db/schema/runtime.ts`
