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

### Campus Search 诊断投影

`execution_control.agent_campus_search_diagnostics` 是 execution-control 所有、Ops Web 只读的专用投影，
以 `(request_id, invocation_id)` 标识一次工具调用，schema version 为 2。它不属于产品事件、工作流
状态或最终答案；不写入 `agent_run_events`、`agent_step_results` 或 App API 的 request observability fact。
请求删除时通过外键级联删除，不单独增加 TTL 或历史回填机制。

v2 硬切由统一 schema migration 0009 删除旧诊断行并替换版本约束；不删除请求、消息、通知或索引。
生产者与 Ops 消费者一起升级，不保留 v1 读取或双写。升级时先停止旧生产者，迁移后启动新版；
历史请求没有诊断时展示无数据，不从日志重建。

Agent Runtime 经现有内部 query auth 上报 queued、dispatching、failed、canceled；成功终态由 execution-control
根据真实 Campus Search 结果写入，服务端记录
received、index_loaded、embedded、retrieved、reranked、selected。固定接口为
`POST /internal/execution/requests/:requestId/campus-search/observations`，仅接收固定生命周期字段，不能
注入候选正文。阶段时间首次观察后保留，后到的早期阶段不会覆盖终态；服务端累积快照和客户端生命周期
合并到同一行，不建立事件日志。写入是旁路操作，有界失败不改变工具结果；工具执行路径不等待诊断数据库写入。

`snapshot_json` 保存当前阶段的有界累计快照，`phase_times_json` 保存固定阶段时间；查询最多 400 字符，
实际检索表达最多 1024 字符，候选最多 24 个。返回正文共最多 4000 字符，排除项预览每项最多 160 字符。
标题和章节各最多 400 字符。正文只服务 Ops 检查 RAG 效果，不发送到聊天事件或外部观测后端；详细 DTO
见 Ops runtime 合同。`cited_result_refs` 只在 finalization 成功后写入，`null` 不等于没有引用。

不记录原始异常、Provider 凭据、完整模型输入输出、dense/sparse 分路候选或无法计算的召回率。未来若
Ops 不再使用逐调用候选诊断，应一起移除生产者、专用路由、表与页面，不保留第二条诊断管道。

### 运行

run 以 `request_id` 为主键，并关联 conversation、`owner_user_id`、`surface`、生命周期、运行版本、
终态原因与 finalization ref。具体工具调用属于 step/result 轨迹，不压缩为单个“所选工具”。

内部状态依次使用 `created`、`queued`、`admitted`、`running` 和可选的 `streaming`；持久取消
意图使用 `cancel_requested`，终态为 `completed`、`failed`、`canceled` 或 `expired`。可重试阶段
可以回到等待状态，但已经由 invocation receipt 标记开始的模型 operation 不重试；任何终态都不可再次
迁移。浏览器连接状态不能用于推断运行状态。

### 运行事件

run event 按顺序记录有界生命周期与 streaming 事实。同一 request 内 event sequence 单调递增。
payload 只能包含 ref 和 summary，不得包含原始 prompt、transcript、provider response 或
source body。

内部与浏览器事件共享同一序列。事件查询的 `next_sequence` 是服务端已检查到的前向游标，可能
大于本次返回的最后一个浏览器事件，也可能在返回空数组时前进；消费者不能从过滤后的事件自行
推导游标。`run.canceled` 由 app-api 转换为浏览器 `request.cancelled`，`run.cancel_requested` 只用于
内部协调。

### 生命周期命令

run 与 workflow 启动命令在一个事务写入。启动命令固定 Workflow ID、队列、输入 ref/hash 和
有界策略版本，并记录租约、租约次数、`dispatch_attempted`、Temporal Run ID 或低基数失败原因；
reconciler 在外部 RPC 前用 lease token 原子置位 dispatch fence，由该写入检查租约、活动状态与取消
意图，不另做租约预读；重复执行不能创建第二个 workflow。
升级前已有命令迁移为 `dispatch_attempted=true`，不能从租约次数反推从未投递。

execution-control 的取消命令与 `cancel_requested` 一起持久化，再由 reconciler 幂等投递。app-api
只负责归属校验并调用 execution-control，不维护自己的取消发件箱，也不以一次 HTTP 成功假装跨库事务。
只要启动命令
已经置位 `dispatch_attempted`，Describe 的 `NotFound` 就不能作为未投递证明；取消命令以
`temporal_start_identity_unresolved` 保持 pending，直到绑定并校验精确 Temporal Run ID，或确认存在
不属于该 run 的身份冲突。只有未置位 dispatch fence 且没有 Temporal Run ID 的启动命令可以直接
收敛为本地取消。

若取消已把 start 置为 `superseded`，命令满足 `dispatch_attempted=true`、尚无 Temporal Run ID，且
Describe 明确返回 `NotFound`，reconciler 使用原 canonical input 触发带一分钟 `StartDelay` 的 recovery
start。recovery starter 完成首次 exact/latest 身份校验并返回精确 root Run ID 后，reconciler 通过现有
条件写入对 superseded start 首写不可变绑定，不重复远端身份证明；之后读取该精确 execution 的当前
状态并取消。绑定后的取消和终态收敛不以 Memo、chain、reset state 或 latest 作为额外归属条件。
recovery 失败或首次绑定身份未知时仍保持 pending，
不得用 latest Run ID 补写绑定。

### 账号删除

`execution_control.agent_*` 是按 `owner_user_id` 维护的账号可删除 projection。App API 接受账号删除后，
先调用 execution-control 建立 owner deletion fence；fence 使新 run 失败关闭，并让活动 run 进入取消排空。
活动 run 全部进入终态、且 Hindsight 已确认个人记忆清除后，execution-control 在一个事务中删除该 owner
的 run 及其 event、step、attempt、result、workflow-start、cancellation 和 invocation receipt projection，
依赖外键 cascade 完成关联清理。

删除完成后保留 `execution_control.owner_deletion_fences` 中的 `state=deleted` tombstone。它只用于拒绝
旧 workflow、重放请求和同 owner 的新 run，不保存用户输入或执行正文。Temporal history 不属于这次投影
删除事务，按 Temporal/platform retention 合同独立保留或过期；App API 仍负责删除自己的完整执行输入和
账号产品数据。

### Step、Attempt 与 Result

`agent_step_results.model_output_diagnostic_json` 是可空的 Ops 专用失败输出诊断列，schema version
为 1。它与不可变的业务 payload 分开，不参与结果重放比较，也不进入 invocation receipt 或 Temporal
Activity 结果。Execution Control 在业务结果持久化后以一秒超时单独写入一次；失败不改变业务结果，
不重试、不在重放时重新调用模型补录。首次写入后不覆盖；缺失行不被诊断写入重建。

诊断只记录 `model_output_invalid` 的可见模型输出前缀（最多 64 KiB UTF-8）、原字节数、截断标记、
校验阶段、最多 1024 字符的错误说明、schema 名称和可空 finish reason。随父请求、账号删除，
不单独增加 TTL 或历史回填。Ops 使用已有请求/步骤/attempt 关联读取这列，不获得完整结果 payload
读取权限。未来移除 Ops 格式错误诊断时应一并删除该列及其生产/消费代码。

step 投影描述持久运行架构中的稳定阶段。阶段语义由
[持久 Agent 运行时](../architecture/system/durable-runtime.md) 维护，具体 `step_id` 与 `step_kind` 由执行代码和
schema 维护。

attempt 投影可以包含 Temporal queue/worker 标识、attempt number、timestamp、duration、
retry/cancel/timeout outcome、可公开的 provider/model 标识及 input/output/cached token
用量。Agent attempt 另外保存 `model_request_count` 和 `usage_observed`：前者来自 Agents SDK
`Usage.requests`，后者区分供应商明确上报为零与没有取得 usage。模型费用由 Langfuse 计算，
不属于 PostgreSQL 持久投影字段。

result 投影包含 status、result kind/ref、拒绝原因和有界 metadata。SDK function call 不得由此形成第二套
workflow graph；Agent Workflow 的计划和步骤只由执行合同及其持久 step 投影拥有。

StepResult 以 `result_id` 首次写入为准；全部字段与规范 JSON payload 相同的重放返回原记录，
任一字段或 payload 不同都冲突且不能覆盖。内存与 PostgreSQL 存储在写入前都先锁定所属 run，
与 run 终态投影保持相同锁顺序。活动 run 可以写入；run 进入终态后默认连相同重放也拒绝。
唯一例外是产品 Finalization 已将 run 置为 `completed` 后的非关键记忆追加：只有
`(memory.append, memory_conversation_append_result)` 这组 `step_id`、`result_kind` 可以首次写入或
相同重放，仍不得覆盖已有结果。`failed`、`canceled`、`expired` 不适用该例外，Agent、知识查询和
Finalization result 也不得在终态后补写。该例外不放宽其他 Activity 的终态写入限制。

### Activity Result 与 Receipt

每个 Agent Workflow operation 的有界结果经由 Temporal Activity result 传给下一阶段；普通 run、event、
step、result 投影只保存 ref、hash、用量和公开终态，不保存模型正文或工具原始载荷。当前在线 workflow
不产生独立的强制预检索阶段或第二套 query result；`campus_search` 的有界返回值属于对应 Execute Step
result。Campus Docs
的离线制品发布由独立 Job 负责，不进入本数据合同。

个人记忆召回不单独建立外部调用 receipt。模型 operation invocation receipt 绑定该 operation 的精确
请求摘要，防止 Activity 重投递再次执行模型或 `personal_memory_recall`。普通 SDK tool 投影只保存
工具身份、参数摘要、`outcome`、结果 hash、产品投影 ref 和真实工具耗时；如果 Runtime 提供 RFC3339
UTC 边界，也保存实际工具调用的起止时间，不保存 `memory_text`。同一工具的重复调用按实际调用顺序分别投影。

Temporal Activity result/input 不是个人记忆数据库。跨 Activity 传递的 memory/tool 结果必须经过
Temporal-facing allowlist 和既有 evidence 字符上限；不得把 provider 原始响应、未裁剪查询、凭据或
调试载荷写入 history。PostgreSQL run/event 删除不代表平台 history 立即消失，账号删除合同必须同时遵守
Temporal retention、访问控制和 replay 可见性边界。

Agent Runtime 的流式 `answer_delta` 只携带临时展示用的 `delta` 和
`agent_runtime_answer_delta.v3`；execution-control 在合并后为浏览器事件分配本地 `chunk_index`。
`answer_completed` 只表示增量流已结束，不复制累积正文；`answer_delta` 是 provisional 展示事实，
`final_output` 是 Finalization 使用的 canonical 答案正文。若最终校验失败，消费者必须丢弃或标记
provisional 增量，不得把它当作有效最终答案。

## Agent Workflow operation 投影

每个 Agent Workflow operation 代表一次 OpenAI Agents SDK run。其有界 metadata 可以包含：

- operation 类型和当前 workflow step 标识；
- 可用的模型可见工具；
- SDK function-tool 调用摘要；
- provider response id 与 model/provider 标识；
- input、output 与 cached token 数量、模型请求数与 usage 是否已观测；
- `final_output` 摘要和运行终态原因。

正式投影不存储 SDK state、raw message 或 raw function payload。

每个 operation 在供应商调用前构造 canonical provider invocation envelope。envelope 的规范 JSON
SHA-256 是 invocation receipt 的 `InputSHA256`，绑定 request、step、operation、invocation、
execution input SHA、admission snapshot SHA 和逻辑请求 SHA。逻辑请求包含实际发送的用户与会话标识、
operation 输入、可见工具、预算、预期模型及工具合同和会话上下文，但排除投递元数据
`activity_attempt`；HTTP 请求仍携带该字段。不能将逻辑摘要解释为精确 HTTP bytes 或最终模型输入的
摘要。envelope 只在本次 Activity 内存中用于生成 receipt fingerprint，不持久化为单独载荷。

运行级 Agent 模型用量按各 operation step 的去重 attempt 聚合。每个已观测 attempt
计算一次，重试已产生的用量不丢弃。`total_tokens` 按 input 与 output 相加，cached input 是 input
子集，不重复计入总数。失败但已取得 SDK 结果的 attempt 仍保存 usage；调用前失败、网络中断或 SDK
抛错且无法取得 usage 时保存 `usage_observed = false`，不用零伪装成真实用量。

invocation receipt 在供应商调用前持久化调用身份、上述 envelope fingerprint 和开始状态。完成时
`OutputJSON` 保存有界的完整类型化 operation output，最大为 1 MiB；`OutputSHA256` 保存其摘要，同时记录完成时间。
该恢复载荷可能包含回答正文、证据和 allowlist 工具结果，不包含原始工具参数、debug 或 failure detail；
memory 正文仅出现在 evidence 中。它不是仅含 ref/hash/schema 的摘要，也不是供应商
原始响应。receipt 先于诊断投影提交；completed receipt 在 Activity 重投递时用于恢复原结果并修复投影。
started receipt 或无法解码的 completed 结果以 `workflow_attempt_uncertain` 阻断；恢复结果仍需通过身份
和来源校验，且首次输出与 replay 共享字段和完整 UTF-8 JSON 大小校验。输出 hash 以恢复后的类型化
序列化校验，不以 JSONB 文本表示计算。修复失败沿用既有错误路径，不重新调用供应商。产品答案由 app-api 拥有。

## Finalization 投影

Finalization 保存 SDK 终态答案和确定性校验结果。机构知识 source 只能来自同一次运行中成功工具的
真实 cited result，并通过该工具对应 adapter 校验；当前只有 `campus_search` 注册 Campus Docs 来源 adapter。
其他来源能力接入时必须由对应合同定义来源校验和公开字段。

Finalization 可以拒绝空正文、无效工具结果或不满足执行合同的 output，但不会创建或改写答案。app-api 可以在
保留答案原文的前提下，把已验证 source 转换为产品 source-item 结构。相同 fingerprint 的完成
可以幂等重放；不同 fingerprint 与已提交的产品终态冲突，execution-control 不得用较晚结果覆盖。

Finalization 读取 workflow 传入的 Agent result，验证身份、执行输入摘要和终态 schema。
`finalization.write` 的 completed StepResult 只保存 agent result ref、request、
`finalization_fingerprint_sha256` 和有界 `finalization_summary`。该 summary 包含答案正文及其 hash、
响应 hash、状态和 Campus/Web 来源计数，不保存完整来源对象、模型用量或完整最终响应。内部
内部 `finalization.completed` event 保留完整 `ExecutionFinalizationResponse`（最多 1 MiB），用于产品回调后的修复和
完成重放校验。新路径不再写同名 browser-visible event；历史版本留下的同名浏览器事件只作为兼容数据，
由 app-api 过滤，不得作为产品成功终态。浏览器成功终态统一使用 `run.completed`，且只能在
`FinalizeRunProjection` 成功后追加。
产品 callback 前还会写入 internal `finalization.reserved` event。它只保存 request、workflow result
ref、`finalization_fingerprint_sha256`、首次 `run.progress(finalizing)` 时间和 canonical completion
时间；同一 Activity 的 retry 或 callback 后 projection/CAS 重试必须复用这组时间。canonical
`finalization.write` Step/Result 与 run.CompletedAt 不采用 Temporal Workflow 的 `FinalizedAt`，
以避免 workflow history 时间早于实际 finalization Activity。

成功 callback 前必须完成 recovery response 字段和大小的确定性校验。产品写入成功后 event 或 projection
失败，可以重发相同 response、fingerprint 和完成时间；app-api 幂等返回，不重复创建产品完成效果。
`FinalizeRunProjection` 是该终态的唯一提交点：它在同一内存临界区或持有 PostgreSQL run-row lock 的
单个事务中，校验并提交 completed `finalization.write` Step、Attempt、Result 与 completed run 四元组，
同时释放 conversation active-run lock。已经存在的 pending 或 leased cancellation 在同一 CAS 中改为
`confirmed` 并记录 `completion_won`；若取消终态先提交，则整个 Finalization 拒绝或回滚。任何消费者都
不得再把独立 Result 写入与 run completion 拼成两阶段终态。

已完成 run 的 Finalization 重放是只读一致性校验：请求的 `CompletedAt`、`TerminalReason`、
`FinalResponseRef` 和 fingerprint 必须与 completed run 一致，且存储中必须存在唯一、
内部引用和 schema 都有效的 canonical Step/Attempt/Result。校验成功只返回原 canonical 四元组，不采用
较晚 candidate 的 ID、时间或 payload，不补写或修改任何 canonical 记录；后续 `run.completed` 事件在
CAS 之外单独幂等补充。若产品 callback 已成功而 canonical projection 发生冲突，只有能证明同一
fingerprint/identity 的 replay 才允许修复；记录存在歧义或不完整时必须 fail-closed，不选择 winner、
不发送错误 callback、不写 `run.failed`，并返回 `finalization_projection_conflict` 供诊断和人工修复。

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

完整 `tool_execution_v7` 输入由 app-api 以精确 UTF-8 文本拥有，execution-control 只持久化
`execution_input_ref` 和 `execution_input_sha256`；ref 指向的数据也不得
复制到上述投影。已经分配 request 的输入在产品终态后仍由 app-api 保留，随 app-api 的会话和用户数据
生命周期删除；execution-control 不维护对应清理记录。

## 消费

app-api 从这些投影生成学生产品 read model。学生浏览器响应只接收 final answer、已批准 source item
和公开 status/error 字段。Ops Web 通过列级只读权限按可信 `request_id` 聚合运行阶段和 Agent
模型用量，不经 app-api 复制到 `runtime.request_observability_fact`。Ops Web 与评测均不读取原始执行
payload。

Ops 的回答终态失败读取 `execution_control.ops_terminal_failures`：只投影 `run.failed` 的失败码和
同代码 activity failure 的有界操作、详情、HTTP 状态、invocation ID。视图不复制事件、不保存额外
状态；原始事件仍不可读，保留与删除跟随原 run。旧事件只有 failure kind 时，其他字段允许为空。
联网搜索诊断存于既有 step/attempt 的 `sanitized_payload_json.web_search_diagnostic`，只含状态、
计数与固定丢弃原因，消费者与字段见 Ops runtime 合同，不采集原始 grounding 响应或查询正文。

## 相关文档

- [执行合同](../contracts/tool-execution.md)
- [持久 Agent 运行时](../architecture/system/durable-runtime.md)

可执行数据结构和状态迁移由 `apps/execution-control/internal/execution` 及其测试维护。
