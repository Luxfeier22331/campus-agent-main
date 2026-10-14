---
doc_type: data
owner_boundary: apps/agent-control
status: active
---
# 持久执行数据

## 边界

本文定义在线执行的有界逻辑投影。Temporal history 始终是 workflow 执行事实；PostgreSQL 投影供
app-api 产品读模型、Ops Web 运行记录、诊断和评测消费，并保存向 Temporal 投递所需的持久命令与
幂等 receipt。跨系统产品终态由 app-api 产品行及其 finalization fingerprint 裁决。

## 核心记录

### Campus Search 诊断投影

`agent_control.agent_campus_search_diagnostics` 是 agent-control 所有、Ops Web 只读的专用投影，
以 `(request_id, invocation_id)` 标识一次工具调用，schema version 为 2。它不属于产品事件、工作流
状态或最终答案；不写入 `agent_run_events`、`agent_step_results` 或 App API 的 request observability fact。
请求删除时通过外键级联删除，不单独增加 TTL 或历史回填机制。

当前只读取 schema v2；历史请求没有诊断时展示无数据，不从日志重建。

Agent Runtime 经 Control 内部接口上报工具生命周期：
`POST /internal/agent/runs/:requestId/campus-search/observations`。
当前 HTTP 合同只接收固定生命周期字段，不接受 snapshot/phaseTimes；Search 返回的完整内部诊断
尚未贯通到该投影。表中存在阶段与候选字段不证明 Runtime 已填充它们，缺失表示无观测数据。
实际 Search 响应与接入缺口见[Campus Search 服务合同](../contracts/campus-search.md#agent-内部接口)。
旁路写入失败不改变工具结果；不从日志或最终答案重建缺失阶段。

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
可以回到等待状态，但已开始且结果未知的单次模型调用不得重新发送；任何终态都不可再次
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

agent-control 的取消命令与 `cancel_requested` 一起持久化，再由 reconciler 幂等投递。app-api
只负责归属校验并调用 agent-control，不维护自己的取消发件箱，也不以一次 HTTP 成功假装跨库事务。
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

`agent_control.agent_*` 是按 `owner_user_id` 维护的账号可删除 projection。App API 接受账号删除后，
先调用 agent-control 建立 owner deletion fence；fence 使新 run 失败关闭，并让活动 run 进入取消排空。
活动 run 全部进入终态、且 Hindsight 已确认个人记忆清除后，agent-control 在一个事务中删除该 owner
的 run 及其 event、step、attempt、result、workflow-start、cancellation 和 invocation receipt projection，
依赖外键 cascade 完成关联清理。

删除完成后保留 `agent_control.owner_deletion_fences` 中的 `state=deleted` tombstone。它只用于拒绝
旧 workflow、重放请求和同 owner 的新 run，不保存用户输入或执行正文。Temporal history 不属于这次投影
删除事务，按 Temporal/platform retention 合同独立保留或过期；App API 仍负责删除自己的完整执行输入和
账号产品数据。

### Step、Attempt 与 Result

`agent_step_results.model_output_diagnostic_json` 是可空的 Ops 专用失败输出诊断列，schema version
为 1。它与不可变的业务 payload 分开，不参与步骤结果重放比较，也不进入 Temporal Activity 的有界决定。模型 receipt 的内部恢复载荷
另由 Runtime 保存，不能与 Ops 专用诊断列混为同一数据合同。agent-control 在业务结果持久化后以一秒超时单独写入一次；失败不改变业务结果，
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
存储仍保留 `completed` 后对旧记忆追加结果的窄例外：只有
`(memory.append, memory_conversation_append_result)` 这组 `step_id`、`result_kind` 可以首次写入或
相同重放，仍不得覆盖已有结果。`failed`、`canceled`、`expired` 不适用该例外，Agent、知识查询和
Finalization result 也不得在终态后补写。该例外不放宽其他 Activity 的终态写入限制。当前 Control 投递器不再创建 `memory.append`
步骤；新的追加进度由独立 Memory 数据库拥有。

### Activity Result 与 Receipt

agent-runtime 的 TypeScript Workflow 调度单次模型请求与单次工具调用。Activity input/result
只携带载荷引用、调用索引及有界阶段决定；阶段输入、完整 continuation 与工具结果通过 Control
内部载荷 API 保存和读取，不把正文放入 Temporal history。

`personal_memory_recall` 是独立工具 Activity，Memory API 负责访问边界。模型 receipt 只约束
单次模型请求，不覆盖整个 operation 或后续工具调用。工具投影记录实际调用身份、状态、结果和
时间，工具 Activity 的重试与预算由 Runtime 的 Workflow 定义。

Control 临时载荷在产品终态、完成事件和 Workflow 关闭均确认后由 reconciler 清理；
app-api 的冻结原始输入仍按会话和账号生命周期保留。临时载荷、模型 receipt、步骤投影与
产品输入不是同一存储边界，评测接口不能据此承诺长期可读取完整模型上下文。

Agent Runtime 通过 Control typed API 发布临时回答增量，Control 不再将正文片段写入
`agent_run_events`。独立 `answer/started` API 将 `answer_started` 与 streaming 状态幂等、原子提交，`answer_completed` 和产品终态继续持久化。
增量经 PostgreSQL 通知广播到在线 Control 副本，各副本保留有界内存缓冲；App API 从现有长轮询接口
读取状态与增量，再通过浏览器 SSE 输出。持久事件使用 `sequence`，临时增量使用 Runtime 产生的
独立 `answerIndex`，两者不得互相推进或充当完成证据。

内存缓冲只提供有限补发；过期、淘汰、重启或广播中断后不保证恢复完整草稿。`final_output` 仍是
Finalization 使用的权威正文；最终校验失败时消费者不得将临时增量当作有效答案。
边界与取舍见[临时回答传输](../../.agents/notes/implemented/architecture/2026-10-13-answer-delta-transport.md)。

## Agent Workflow operation 投影

每个 operation 可以包含多个模型轮次与工具 Activity。阶段投影保存 operation、步骤身份、
状态、工具摘要、模型标识和用量；不是一整个 OpenAI SDK run 的别名，Gemini 也使用相同阶段合同。
原始模型 continuation 属于内部恢复载荷，不是 Ops 的步骤 metadata。

单次模型调用的 invocation ID 包含 request、stage key 和模型 turn 序号；Runtime 以 stage ref 与
当前状态的摘要绑定该调用。该摘要不是最终 Provider HTTP 请求字节的 hash。
实现由 [modelTurn Activity](../../apps/agent-runtime/src/activities.ts)和 Control receipt API 维护。

运行级 Agent 模型用量按各 operation step 的去重 attempt 聚合。每个已观测 attempt
计算一次，重试已产生的用量不丢弃。`total_tokens` 按 input 与 output 相加，cached input 是 input
子集，不重复计入总数。失败但已取得 SDK 结果的 attempt 仍保存 usage；调用前失败、网络中断或 SDK
抛错且无法取得 usage 时保存 `usage_observed = false`，不用零伪装成真实用量。

invocation receipt 在供应商调用前保存调用身份、输入摘要和开始状态，完成后保存类型化的
单次模型轮次结果 `TurnRecord` 及输出摘要。恢复载荷可包含 provider continuation 和模型输出，
只用于内部恢复，不是普通 trace 或 Ops 查询输入。已经完成的 receipt 可恢复结果并修复投影；
已开始且结果未知时以 `workflow_attempt_uncertain` 阻断，不再次调用供应商。
阶段结果提交和单次模型 receipt 分开；Control 不创建旧 operation 级模型调用 receipt。

## Finalization 投影

Finalization 保存 Runtime 终态答案和确定性校验结果。机构知识 source 只能来自同一次运行中成功工具的
真实 cited result，并通过该工具对应 adapter 校验；当前只有 `campus_search` 注册 Campus Docs 来源 adapter。
其他来源能力接入时必须由对应合同定义来源校验和公开字段。

Finalization 可以拒绝空正文、无效工具结果或不满足执行合同的 output，但不会创建或改写答案。app-api 可以在
保留答案原文的前提下，把已验证 source 转换为产品 source-item 结构。相同 fingerprint 的完成
可以幂等重放；不同 fingerprint 与已提交的产品终态冲突，agent-control 不得用较晚结果覆盖。

Finalization 读取 workflow 传入的 Agent result，验证身份、执行输入摘要和终态 schema。
`finalization.write` 的 completed StepResult 只保存 agent result ref、request、
`finalization_fingerprint_sha256` 和有界 `finalization_summary`。该 summary 包含答案正文及其 hash、
响应 hash、状态和 Campus/Web 来源计数，不保存完整来源对象、模型用量或完整最终响应。
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

运行摘要、公开事件和 Ops 常规字段不复制原始 prompt、完整对话、Provider request/response、SDK state、
记忆正文或认证材料。内部阶段结果、模型 receipt 和临时载荷分别遵守前述恢复与保留合同，不能把
它们与公开摘要混为一类。最终答案、Ops 有界模型输出诊断与 Campus Search 候选快照按各自明确合同读取。

完整 `tool_execution_v7` 原始输入由 app-api 以精确 UTF-8 文本拥有，Control 的 run 保存
`execution_input_ref` 和 `execution_input_sha256`；Runtime 准备的阶段输入另存 Control 临时载荷，
不放入 run metadata 或 Temporal history。原始输入随 App API 会话和账号数据删除，Control 不维护
这份产品输入的清理记录；Control 临时载荷由自己的 reconciler 清理。

## 消费

app-api 从这些投影生成学生产品 read model。学生浏览器响应只接收 final answer、已批准 source item
和公开 status/error 字段。Ops Web 通过列级只读权限按可信 `request_id` 聚合运行阶段和 Agent
模型用量，不经 app-api 复制到 `runtime.request_observability_fact`。Ops Web 与评测均不读取原始执行
payload。

Ops 的回答终态失败读取 `agent_control.ops_terminal_failures`：只投影 `run.failed` 的失败码和
同代码 activity failure 的有界操作、详情、HTTP 状态、invocation ID。视图不复制事件、不保存额外
状态；原始事件仍不可读，保留与删除跟随原 run。旧事件只有 failure kind 时，其他字段允许为空。
联网搜索诊断存于既有 step/attempt 的 `sanitized_payload_json.web_search_diagnostic`，只含状态、
计数与固定丢弃原因，消费者与字段见 Ops runtime 合同，不采集原始 grounding 响应或查询正文。

## 相关文档

- [执行合同](../contracts/tool-execution.md)
- [持久 Agent 运行时](../architecture/system/durable-runtime.md)

可执行数据结构和状态迁移由 `apps/agent-control/internal/execution` 及其测试维护。
