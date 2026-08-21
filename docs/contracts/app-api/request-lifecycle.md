---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# 聊天请求生命周期

## 文档边界

本文定义 `POST /api/chat/requests` 和 stream 变体从接收 turn 到最终消息写入的持久化与
幂等规则。execution-control 的 Temporal workflow、事件合同和内部步骤不在本文重复定义。

## 数据所有者

- `chat.conversations` 和 `chat.messages` 保存用户可见会话。
- `chat.turn_dispatches` 保存一次 turn 的 admission、关联标识、幂等键和最终状态。
- `runtime.request_observability_fact` 保存受控诊断摘要。
- execution-control 使用同一个 `run_id` 在 `execution_control.agent_*` 中保存 workflow projection。
- Temporal 保存完整 workflow history。

三者不是同一状态的三个写入者：`chat.turn_dispatches` 只裁决产品是否已接收以及用户可见终态，
`execution_control.agent_*` 只描述持久运行，Temporal 只保存工作流历史和调度状态。execution-control 已经
产生终态不等于 App API 已经保存助手消息；App API 的 `accepted` 也不能证明 Temporal 已经开始执行。

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
3. 以 `status=accepted, admission_status=pending_admission` 写入 `chat.turn_dispatches`；
4. 写入 accepted observability fact；
5. 推进 conversation active turn/run 指针。

事务先锁定并核对 conversation 的 active branch/message/run/turn 基线，再读取一次 memory settings
快照；基线已经变化时整个接收事务以冲突回滚，不使用旧上下文静默生成新 turn。同一事务使用这份
memory 快照冻结准入命令和执行输入的原始 UTF-8 JSON 文本及其 SHA-256。冻结失败会回滚 user
message、turn dispatch 和 observability fact。事务提交后才调用
execution-control 创建持久 run；数据库使用 `text` 保留参与 hash 的精确字节，不能经 PostgreSQL
`jsonb` 规范化后再验证。可重试的创建失败保留为待准入状态，由幂等 dispatcher 使用已冻结且
校验 hash 的同一输入重试；身份冲突、合同拒绝等可确定的永久失败必须通过产品终结事务持久化为
`admission_failed`，不能归还 claim 或形成热重试。任何路径都不能创建第二个 turn 或丢失关联标识。

## 持久运行

app-api 向 execution-control 发送 `request_id`、`run_id`、`trace_id`、输入 ref/hash 和最小运行
metadata。完整会话上下文及 principal/authorization 投影只保存在 app-api 冻结输入中，由
execution-control 通过带独立认证且禁止缓存的内部接口按 ref 读取。公开聊天不发送工具选择、
document scope、collection 或检索控制参数。关联标识必须在后续事件中保持一致；
不一致的事件以验证错误拒绝。

stream 请求在产品事务持久化且稳定 `run_id` 可供查询、恢复和取消后发送
`request.accepted`。该事件不表示 Temporal 已排队或 worker 已开始，app-api 不合成未由持久事件
证明的 `execution.queued`。随后只转发受类型约束的 `execution.queued`、`execution.running`、
`execution.phase`、`answer.delta` 和请求终态事件；`execution.phase` 只允许
`preparing|generating|finalizing`。app-api 使用 execution-control 返回的
`next_sequence` 跨过不可见内部事件。客户端断开只停止当前连接消费，不自动取消运行；显式取消先写入
app-api 取消发件箱，再由 reconciler 幂等投递 execution-control。

conversation detail 的 `activeRunId` 是浏览器刷新恢复入口。客户端必须先读取 run 摘要，再从持久事件
游标恢复当前消息与状态；恢复流程不得重新提交 prompt，也不得生成新的 idempotency key 或第二个 run。

## 最终事务

收到 terminal event 后，app-api 在同一事务内：

1. 将目标 turn dispatch 从 `accepted` 更新为终态；
2. 写入 assistant message 和 structured parts；
3. 更新 observability fact；
4. 仅当该 run 仍是 active run 时推进 conversation branch/head；
5. 仅在 `completed` 时写入明确确认的 session slots。

同一个 request 不能再次终结。较旧分支完成时可以保存自己的结果，但不能覆盖更新的 active
branch/head。

最终事务先锁定 turn dispatch。execution-control 的 durable product finalization 明确确认 run 已被
持久执行；它先于 `markAdmitted` 到达，或本地确认失败后 claim 已归还 `pending_admission` 时，锁内均将
准入状态归一化为 `admitted` 后提交终态。本地取消已经取得的 `cancelled` 不得被覆盖，尚未发生 durable
admission 的本地终态归为 `admission_failed`。这样 callback、admission 确认和取消竞争只由同一产品行
裁决，不依赖调用返回顺序。

产品终态的 replay 身份是 `(finalization_fingerprint, canonical completed_at)`。两项都与已提交值
表示同一 fingerprint 和同一时刻时为精确 replay，必须零写入并返回 `replayed`；fingerprint 或时刻
不一致，以及只存在其中一项的半身份状态，均返回 `finalization_conflict`。只有首次 `applied` 可以
写 assistant message、observability fact、session slots，并发送 finalized 或 transport-error
telemetry；精确 replay 不重复发送遥测。

取消只有在该产品终态已持久化后才能作为 `run.canceled` 向浏览器发布；执行输入只在终态完成后
通过幂等内部删除接口释放。

execution-control 提交产品终态时，内部回调正文使用 `completed_at`、
`finalization_fingerprint` 和 `response_json`。`response_json` 是发送端对最终响应执行 Go
`json.Marshal` 后得到的精确 UTF-8 JSON 文本，也是跨语言校验的唯一字节真值；fingerprint 为
`SHA256(run_id + NUL + response_json 的精确 UTF-8 字节)`。app-api 必须先按原字符串校验
fingerprint，再解析并校验最终响应合同，不得对解析结果重新序列化后计算 fingerprint，也不接受
已退役的 `response` 对象字段作为 fallback。

## 幂等

- 非空幂等键以 `(actor_user_id, idempotency_key)` 唯一。
- 同一键和同一 request fingerprint 返回已有结果或已有 accepted 状态。
- 同一键对应不同 fingerprint 时返回冲突，不创建第二个 turn。
- 接收前查询只用于快速 replay；并发首写由接收事务内唯一约束裁决，冲突后回读 winner 并应用相同
  fingerprint 规则，不把数据库唯一冲突暴露为内部错误。
- 没有幂等键时不提供跨请求 deduplication。

## Ops Web 关联

Ops Web 以 `chat.turn_dispatches` 为 request 列表起点，按 `run_id` 左连接
`execution_control.agent_runs`，并通过 `user_message_id` 读取 `chat.messages` 的问题摘要。主列表不依赖
`runtime.request_observability_fact`，也不需要 app-api projector 或通过 app-api 运维接口读取。
其他获准诊断消费者即使读取该表，也不能用它覆盖请求或运行状态。

## 失败边界

- 缺少数据库、execution-control、合同或授权时失败关闭。
- 不使用内存队列、JSONL、遥测或聊天正文重建持久状态。
- 不在执行失败时启动第二条同步回答路径。

## 可执行来源

- `apps/app-api/src/modules/runtime-command/`
- `apps/app-api/src/modules/runtime-run/`
- `apps/app-api/src/db/schema/chat.ts`
- `apps/app-api/src/db/schema/runtime.ts`
