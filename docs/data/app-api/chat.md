---
doc_type: data
owner_boundary: apps/app-api
status: active
---
# 聊天数据

## 文档边界

本文定义 app-api 拥有的 `chat.*` 产品数据及其主要不变量。精确字段、索引和迁移以
`apps/app-api/src/db/schema/chat.ts`、SQL 基线和所有者测试为准。

## `chat.conversations`

保存用户会话、标题、归档、置顶、软删除和创建更新时间。

- 每个会话只属于一个产品用户；
- 列表和搜索必须按当前用户过滤；
- 软删除会话不进入普通列表和详情；
- 会话可以显式创建，也可以在首轮聊天请求中创建；
- 该表不保存执行步骤、检索内容或运维请求。

## `chat.messages`

保存会话中的用户与助手消息，并通过可选 `request_id` 关联产生助手消息的请求。

助手消息类型当前只包括 `answer` 和 `error`。追问、资料不足和范围说明都属于正常助手正文，写为
`answer`；用户消息不写助手消息类型。

`structured_parts_json` 只保存已经进入产品合同的结构化展示内容。app-api 必须把执行侧数据
转换为浏览器合同，不保存供应商原始响应、内部工具参数或内部标识。

## `chat.turn_dispatches`

保存一次用户轮次的接收、幂等、请求与运行关联以及最终状态。它是 app-api 请求生命周期的
产品记录，不是 Temporal 工作流历史或 execution-control 运行投影。

- 同一用户和幂等键只能对应同一轮请求；
- 接收事务必须同时建立用户消息、轮次记录和请求观测记录；
- 最终事务写入助手消息并更新轮次终态；
- 状态和事务规则见 `docs/contracts/app-api/request-lifecycle.md`，执行输入、准入与取消协调数据见
  `runtime.md`。

## `chat.message_feedback`

保存当前用户对一条助手消息的最新反馈。

- 每个用户对一条消息最多保留一份当前反馈；
- 目标必须是该用户会话中的非错误助手消息，并且具有 `request_id`；
- `vote` 允许 `helpful` 或 `unhelpful`；原因码只用于 `unhelpful`，最多三个且不能重复；
- 当前不保存自由文本评论；
- 删除反馈时直接删除当前记录，不保留墓碑；
- 反馈不参与授权、工具开放、记忆或在线执行准入。

反馈是产品事实，不自动成为评测输入或发布结论。需要使用时，由具体评测命令的调用方显式提供所需
数据；不建立独立的候选选择流程。

## `chat.session_slots`

保存会话内已经确认、可以供后续轮次使用的结构化槽位。当前只承载培养方案相关的：

- `curriculum_program_family`
- `curriculum_program`
- `curriculum_semester`

只有终结结果中明确确认的结构化值才能写入。澄清请求、普通别名冲突、软偏好和未确认草稿
不得写入。每次更新替换该会话的当前快照，不追加历史值。

这些槽位不直接出现在浏览器聊天合同中，也不保存原始会话摘要或模型草稿。

## 个人记忆边界\n\n删除会话或裁剪消息不联动清理 Hindsight；聊天准入只保存记忆开关和 generation，不携带管理命令序号。\n个人记忆内容以 Hindsight 为准，App API 只保存设置和 durable commands；普通命令成功后清空正文，\n失败保留供用户重试，整库清除移除全部旧命令正文。详见 [个人记忆合同](../../contracts/app-api/memory.md)。\n\n## 数据边界

- `chat.*` 拥有会话、消息、轮次接收和产品反馈；
- `runtime.request_observability_fact` 拥有 app-api 产品运行摘要；
- `execution_control.agent_*` 由 execution-control 拥有；
- Langfuse 拥有受信任的模型调用轨迹；
- Hindsight 拥有在线个人记忆提取和召回。

## 相关文档

- [聊天接口](../../contracts/app-api/chat.md)
- [请求生命周期](../../contracts/app-api/request-lifecycle.md)
- [App API 运行时数据](./runtime.md)
- [持久运行数据](../durable-runtime.md)
