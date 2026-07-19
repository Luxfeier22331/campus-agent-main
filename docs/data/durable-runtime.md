---
doc_type: data
owner_boundary: apps/execution-control
status: active
---
# 持久执行数据

## 边界

本文定义在线执行的有界逻辑投影。Temporal history 始终是执行事实；PostgreSQL 投影供
app-api、诊断和评测消费。

## 核心记录

### 运行

run 关联 conversation、turn、request、trace、`owner_user_id`、`surface`、生命周期、运行版本、
所选工具或 handoff、终态原因与 finalization ref。

内部状态依次使用 `created`、`queued`、`admitted`、`running` 和可选的 `streaming`；终态为
`completed`、`failed`、`canceled` 或 `expired`。运行可以从 `running` 或 `streaming` 回到
`queued` 等待 Temporal 重试，但任何终态都不可再次迁移。浏览器连接状态不能用于推断运行状态。

### 运行事件

run event 按顺序记录有界生命周期与 streaming 事实。同一 run 内 event sequence 单调递增。
payload 只能包含 ref 和 summary，不得包含原始 prompt、transcript、provider response 或
source body。

### Step、Attempt 与 Result

step 投影描述持久运行架构中的稳定阶段。阶段语义由
`../architecture/system/durable-runtime.md` 维护，具体 `step_id` 与 `step_kind` 由执行代码和
schema 维护。

attempt 投影可以包含 Temporal queue/worker 标识、attempt number、timestamp、duration、
retry/cancel/timeout outcome、可公开的 provider/model 标识及 input/output/cached token
用量。模型费用由 Langfuse 计算，不属于 PostgreSQL 持久投影字段。

result 投影包含 status、result kind/ref、拒绝原因和有界 metadata。SDK 内部 handoff
或 function call 不得由此形成第二套 workflow graph。

## Agent Activity 投影

Agent Activity 代表一次完整的 OpenAI Agents SDK run。其有界 metadata 可以包含：

- primary/last-agent 标识；
- 可用和已选的模型可见工具；
- Knowledge Agent handoff 是否发生；
- SDK function-tool 调用摘要；
- provider response id 与 model/provider 标识；
- input、output 与 cached token 数量；
- 结构化终态结果。

正式投影不存储 SDK state、raw message 或 raw function payload。

## 知识搜索投影

每次内部 `knowledge_search` 调用都关联 run 与 SDK invocation id。有界投影包含：

- 已准入的查询结构和 hash；
- 已解析目标、历史模式和搜索序号；
- 找到或无依据结果；
- 有界依据引用与来源标识；
- 结果引用、延迟和失败关闭原因。

原始 query vector、Qdrant payload、provider response 和无限制 snippet 一律禁止。

## Finalization 投影

Finalization 保存 SDK 终态答案和确定性校验结果。有证据支持时，还会保存从可信
`knowledge_search` evidence 派生的浏览器可用 source。

Finalization 可以拒绝格式错误或不受支持的 output，但不会创建或改写答案。app-api 可以在
保留答案原文的前提下，把已验证 source 转换为产品 source-item 结构。

## 终态与失败数据

取消、超时、失败关闭、较晚完成、供应商中止结果与缺失用量必须能归因到所属阶段或内部工具
调用。面向用户的错误文本不能替代低基数终态或失败关闭代码。较晚成功不能覆盖已进入终态的
run 或阶段结果。

## 数据安全

正式投影不得包含：

- 原始 prompt、transcript 或 model output payload；
- 原始 provider request/response 或 SDK state；
- 原始 memory payload 或 vendor id；
- auth token、cookie 或 credential；
- 原始 source body、Qdrant point 或 object-store bytes；
- 本地文件路径。

## 消费

app-api 从这些投影生成浏览器 read model。浏览器响应只接收 final answer、已批准 source item
和公开 status/error 字段；诊断与评测消费有界生命周期、阶段/工具摘要和关联 ref，不读取原始
执行 payload。

## 相关文档

- `../contracts/tool-execution.md`
- `../architecture/system/durable-runtime.md`

可执行数据结构和状态迁移由 `apps/execution-control/internal/execution` 及其测试维护。
