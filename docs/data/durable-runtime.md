---
doc_type: data
owner_boundary: apps/execution-control
status: active
---
# 持久执行数据

## 边界

本文定义在线执行的有界逻辑投影。Temporal history 始终是 workflow 执行事实；PostgreSQL 投影供
app-api 产品读模型、Ops Web 运行记录、诊断和评测消费，并保存向 Temporal 投递所需的持久命令与
幂等 receipt。跨系统产品终态由 app-api 产品行及其 finalization fingerprint 裁决。

## 核心记录

### 运行

run 关联 conversation、turn、request、trace、`owner_user_id`、`surface`、生命周期、运行版本、
终态原因与 finalization ref。具体工具调用属于 step/result 轨迹，不压缩为单个“所选工具”。

内部状态依次使用 `created`、`queued`、`admitted`、`running` 和可选的 `streaming`；持久取消
意图使用 `cancel_requested`，终态为 `completed`、`failed`、`canceled` 或 `expired`。可重试阶段
可以回到等待状态，但 Primary Agent provider invocation 不重试；任何终态都不可再次迁移。浏览器连接
状态不能用于推断运行状态。

### 运行事件

run event 按顺序记录有界生命周期与 streaming 事实。同一 run 内 event sequence 单调递增。
payload 只能包含 ref 和 summary，不得包含原始 prompt、transcript、provider response 或
source body。

内部与浏览器事件共享同一序列。事件查询的 `next_sequence` 是服务端已检查到的前向游标，可能
大于本次返回的最后一个浏览器事件，也可能在返回空数组时前进；消费者不能从过滤后的事件自行
推导游标。`run.canceled` 是浏览器事件，`run.cancel_requested` 只用于内部协调。

### 生命周期命令

run 与 workflow 启动命令在一个事务写入。启动命令固定 Workflow ID、队列、输入 ref/hash 和
有界策略版本，并记录租约、租约次数、`dispatch_attempted`、Temporal Run ID 或低基数失败原因；
reconciler 在外部 RPC 前用 lease token 原子置位 dispatch fence，重复执行不能创建第二个 workflow。
升级前已有命令迁移为 `dispatch_attempted=true`，不能从租约次数反推从未投递。

execution-control 的取消命令与 `cancel_requested` 一起持久化，再由 reconciler 幂等投递。它与
app-api 自己的取消发件箱是两个所有者各自的提交点，不以一次 HTTP 成功假装跨库事务。只要启动命令
已经置位 `dispatch_attempted`，Describe 的 `NotFound` 就不能作为未投递证明；取消命令以
`temporal_start_identity_unresolved` 保持 pending，直到绑定并校验精确 Temporal Run ID，或确认存在
不属于该 run 的身份冲突。只有未置位 dispatch fence 且没有 Temporal Run ID 的启动命令可以直接
收敛为本地取消。

若取消已把 start 置为 `superseded`，命令满足 `dispatch_attempted=true`、尚无 Temporal Run ID，且
Describe 明确返回 `NotFound`，reconciler 使用原 canonical input 触发带一分钟 `StartDelay` 的 recovery
start。只有 recovery root 通过 exact/latest 身份校验后，存储才允许对 superseded start 首写不可变
Temporal Run ID；之后取消继续使用该精确绑定。recovery 失败或身份未知时仍保持 pending，
不得用 latest Run ID 补写绑定。

### Step、Attempt 与 Result

step 投影描述持久运行架构中的稳定阶段。阶段语义由
`../architecture/system/durable-runtime.md` 维护，具体 `step_id` 与 `step_kind` 由执行代码和
schema 维护。

attempt 投影可以包含 Temporal queue/worker 标识、attempt number、timestamp、duration、
retry/cancel/timeout outcome、可公开的 provider/model 标识及 input/output/cached token
用量。Agent attempt 另外保存 `model_request_count` 和 `usage_observed`：前者来自 Agents SDK
`Usage.requests`，后者区分供应商明确上报为零与没有取得 usage。模型费用由 Langfuse 计算，
不属于 PostgreSQL 持久投影字段。

result 投影包含 status、result kind/ref、拒绝原因和有界 metadata。SDK function call 不得由此
形成第二套 workflow graph。

StepResult 以 `result_id` 首次写入为准；全部字段与规范 JSON payload 相同的重放返回原记录，
任一字段或 payload 不同都冲突且不能覆盖。内存与 PostgreSQL 存储在写入前都先锁定所属 run，
与 run 终态投影保持相同锁顺序。活动 run 可以写入；run 进入终态后默认连相同重放也拒绝。
唯一例外是产品 Finalization 已将 run 置为 `completed` 后的非关键记忆追加：只有
`(memory.append, memory_conversation_append_result)` 这组 `step_id`、`result_kind` 可以首次写入或
相同重放，仍不得覆盖已有结果。`failed`、`canceled`、`expired` 不适用该例外，Agent、知识查询和
Finalization result 也不得在终态后补写。该例外不放宽其他 Activity 的终态写入限制。

### Activity Result 与 Receipt

`grounding_context.v2` 绑定 run、完整 admission snapshot hash、冻结 grounding plan hash 和查询
hash。它最多包含 8 条 evidence 和 4096 token，作为 Grounding Activity 的有界 result 写入 Temporal
history，再传给 Primary Agent 与 Finalization。Primary Agent 的完整有界结果同样经由 Temporal
history 传递；当前合同不要求加密 Temporal history，也不要求按 run 删除这些正文。

普通 run、event、step、result 投影不保存上述 canonical 正文，只保存 ref、hash、计数、用量和公开
终态。`none` 路径不执行 Grounding Activity，由 Primary Agent Activity 建立 `not_required` context。
Grounding Activity 的重试会重新执行只读 embedding/Qdrant 查询，而不是从 PostgreSQL 重放先前结果。

个人记忆召回不单独建立外部调用 receipt。Primary Agent invocation receipt 绑定整个 SDK run 的精确
请求摘要，防止 Activity 重投递再次执行模型或 `personal_memory_recall`。普通 SDK tool 投影只保存
工具身份、参数摘要、`outcome`、结果 hash/ref 和真实工具耗时，不保存 `memory_text`。

## Agent Activity 投影

Agent Activity 代表一次完整的 OpenAI Agents SDK run。其有界 metadata 可以包含：

- Primary Agent 标识；
- 可用的模型可见工具；
- SDK function-tool 调用摘要；
- provider response id 与 model/provider 标识；
- input、output 与 cached token 数量、模型请求数与 usage 是否已观测；
- 结构化终态结果。

正式投影不存储 SDK state、raw message 或 raw function payload。

Primary Agent 在供应商调用前构造 canonical provider invocation envelope。envelope 的规范 JSON
SHA-256 是 invocation receipt 的 `InputSHA256`，绑定 run、invocation、Activity attempt、完整
Activity input SHA、execution input SHA、完整 admission snapshot 及其 SHA、模型可见工具、最终模型
上下文 SHA，以及实际发送给 agent-runtime 的 HTTP body SHA。HTTP 调用必须发送计算 request SHA 时的
同一份编码 bytes，不能在计算摘要后重新编码。envelope 只在本次 Activity 内存中用于生成 receipt
fingerprint，不持久化为单独载荷。

运行级 Agent 模型用量只聚合 `step_id = 'agent.primary'` 的去重 attempt。每个已观测 attempt
计算一次，重试已产生的用量不丢弃。`total_tokens` 按 input 与 output 相加，cached input 是 input
子集，不重复计入总数。失败但已取得 SDK 结果的 attempt 仍保存 usage；调用前失败、网络中断或 SDK
抛错且无法取得 usage 时保存 `usage_observed = false`，不用零伪装成真实用量。

invocation receipt 在供应商调用前持久化调用身份、上述 envelope fingerprint 和开始状态。完成时它只
保存 `provider_invocation_sha256`、Agent result ref 与 schema version 的摘要，不保存模型正文、prompt、
对话、工具原始参数或供应商完整响应。完整有界 Agent result 由 Temporal Activity result 传给下一阶段；
provider/model 与有界用量摘要保存于正式投影中。已开始或已完成 receipt 但没有可用 Activity result 时，
只能以 `agent_attempt_uncertain` 失败关闭，不能重新调用供应商。

## Grounding 投影

每个 run 至多生成一份 `grounding_context.v2` Activity result。`single_scope` 和 `multi_scope` 路径
最多有一个 `grounding.prepare` step；`none` 路径不创建该 step。检索路径的普通 StepResult 只保存
context ref、路由与覆盖状态、候选数、证据数、token 数、准入与计划 hash、查询 hash 和四个 grounding
子阶段耗时；完整证据及正文只存在于该 run 的 Temporal history。

grounding 不派生 SDK tool call，不携带 `tool_name` 或 `eval_safe_args`。原始 query vector、Qdrant
响应、Provider 凭据和正文不得进入普通投影。

## Finalization 投影

Finalization 保存 SDK 终态答案和确定性校验结果。有证据支持时，还会保存从本轮 workflow grounding
中已引用 evidence 派生的浏览器可用 source。

Finalization 可以拒绝格式错误或不受支持的 output，但不会创建或改写答案。app-api 可以在
保留答案原文的前提下，把已验证 source 转换为产品 source-item 结构。相同 fingerprint 的完成
可以幂等重放；不同 fingerprint 与已提交的产品终态冲突，execution-control 不得用较晚结果覆盖。

Finalization 读取 workflow 传入的 Agent result 后，必须验证 result 身份、冻结准入快照、grounding
绑定、终态 schema 与 evidence 引用。`finalization.write` 的 completed StepResult 保存由 agent result
ref、最终响应、request/trace 生成的 `finalization_fingerprint_sha256`。
`FinalizeRunProjection` 是该终态的唯一提交点：它在同一内存临界区或持有 PostgreSQL run-row lock 的
单个事务中，校验并提交 completed `finalization.write` Step、Attempt、Result 与 completed run 四元组，
同时释放 conversation active-run lock。已经存在的 pending 或 leased cancellation 在同一 CAS 中改为
`confirmed` 并记录 `completion_won`；若取消终态先提交，则整个 Finalization 拒绝或回滚。任何消费者都
不得再把独立 Result 写入与 run completion 拼成两阶段终态。

已完成 run 的 Finalization 重放是只读一致性校验：请求的 `CompletedAt`、`TerminalReason`、
`FinalResponseRef` 和 fingerprint 必须与 completed run 一致，且存储中必须存在唯一、
内部引用和 schema 都有效的 canonical Step/Attempt/Result。校验成功只返回原 canonical 四元组，不采用
较晚 candidate 的 ID、时间或 payload，不补写或修改任何 canonical 记录；后续 `run.completed` 事件在
CAS 之外单独幂等补充。

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

完整 `tool_execution_v5` 输入由 app-api 以精确 UTF-8 文本拥有，execution-control 只持久化
`execution_input_ref` 和 `execution_input_sha256`；ref 指向的数据也不得
复制到上述投影。已经分配 run 的输入在产品终态后仍由 app-api 保留，随 app-api 的会话和用户数据
生命周期删除；execution-control 不维护对应清理记录。

## 消费

app-api 从这些投影生成学生产品 read model。学生浏览器响应只接收 final answer、已批准 source item
和公开 status/error 字段。Ops Web 通过列级只读权限按可信 `run_id` 聚合运行步骤、重试和 Agent
模型用量，不经 app-api 复制到 `runtime.request_observability_fact`。Ops Web 与评测均不读取原始执行
payload。

## 相关文档

- `../contracts/tool-execution.md`
- `../architecture/system/durable-runtime.md`

可执行数据结构和状态迁移由 `apps/execution-control/internal/execution` 及其测试维护。
