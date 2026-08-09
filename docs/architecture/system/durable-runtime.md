---
doc_type: architecture
owner_boundary: execution-control
status: active
---
# 持久 Agent 运行时

## 文档边界

本文定义在线回答的持久生命周期。Temporal 维护 workflow history、task queue、retry、timer
和 activity dispatch；execution-control 负责执行准入、命令投递和有界投影；OpenAI Agents SDK
负责一个 Agent Activity 内的代理与工具循环。app-api 拥有产品请求、原始执行输入和跨系统产品
终态。

## 主要对象

- `Conversation`、`Turn`：app-api 产品事实；
- `Run`：产品可见持久执行对象；
- `ToolExecutionWorkflow`：一个 run 的 Temporal workflow；
- `WorkflowStartCommand`、`CancellationCommand`：将已提交的 PostgreSQL 意图投递给 Temporal
  的持久命令；
- `AgentInvocationReceipt`：约束具有外部副作用的 Primary Agent 调用只能开始一次；
- `RunEvent`、`RunStep`、`StepAttempt`、`StepResult`：有界投影，不是 workflow
  history；
- `Finalization`：app-api 消费的已验证终态投影。

PostgreSQL 保存产品读取、运维和评测所需的有界投影，不是执行队列或 Temporal history 副本。

## 执行阶段

1. **Grounding Prepare（可选）**：仅在本地 grounding plan 选中一个或多个文档范围时，在 agent queue
   读取冻结准入，对当前问题执行一次 embedding，并发查询已准入文档范围，使用 Qdrant dense+sparse
   RRF 分数统一排序后，将有界 `grounding_context.v2` 作为 Activity result 交给 workflow。`none`
   路径跳过该 Activity，并由 Agent Activity 建立 `not_required` context。
2. **Agent Activity**：在 agent queue 只调用一次 `apps/agent-runtime`，完成 Primary Agent、可选的
   单次个人记忆工具调用和结构化终态输出。
3. **Finalization**：在 core queue 校验终态输出与本轮 grounding 引用、生成来源并写入最终投影。
4. **Memory Append**：在 core queue 提交有界的回答后记忆追加。

Temporal 不把每个 scope 查询、候选、RRF 合并或 SDK tool call 展开成额外阶段，也不存在工作流
重新规划状态。grounding 是否执行在 admission 时确定。`GroundingContext` 最多包含 8 条 evidence 和
4096 token；它从 Grounding Activity 传给 Agent Activity，随后与有界 Agent 结果一起由 workflow
传给 Finalization。上述内容会进入 Temporal history；当前合同不要求对 Temporal history 加密或按 run
删除正文。

PostgreSQL 只保存 ref、hash、计数、用量和产品终态等有界投影，不保存 canonical grounding 或完整
Agent 结果。Grounding Activity 重试时重新执行只读 embedding/Qdrant 查询；它不通过另一份运行时
存储重放旧结果。

`personal_memory_recall` 不建立独立载荷。它的完整返回值是有界 Agent result 的一部分；Primary Agent
invocation receipt 约束包含模型和工具调用的整个 SDK run 只能开始一次。若 receipt 已是 `started` 或
`completed`，但本次 Activity 没有可用的 Temporal result，执行以 `agent_attempt_uncertain` 失败关闭，
不再次调用 Provider。精确绑定字段和 StepResult 写入边界见 `../../data/durable-runtime.md`。

## 启动与取消命令

execution-control 的创建事务同时写入 run 与 workflow 启动命令，然后即可把稳定 run 返回给
app-api。后台 reconciler 租约并幂等投递命令，因此 API 响应、进程退出或 Temporal 返回不确定时
都不会要求删除 run 或猜测 workflow 是否已启动。

每个在线回答固定使用 `campus-agent.chat.{runId}` 作为 Workflow ID。与仍开放的同 ID workflow
冲突时使用 `USE_EXISTING`，关闭后重放使用 `REJECT_DUPLICATE`；reconciler 读取已有执行并确认
Temporal Run ID，而不是创建第二个 workflow。Workflow 输入只包含关联标识、输入 ref/hash、有界
策略版本和执行预算，不包含 prompt、会话正文、认证投影或完整工具载荷。

Temporal 返回 `WorkflowExecutionAlreadyStarted` 只表示同 Workflow ID 已存在，不能直接确认本次
启动成功。starter 必须取得 `ExecuteWorkflow` 返回的具体 Run ID，或
`WorkflowExecutionAlreadyStarted.RunId`，再依次 Describe 该精确 execution 与同 Workflow ID 的
latest execution。精确 execution 必须是 `first_run_id` 等于自身 Run ID 的 root；两次结果都必须
通过完整 Memo 校验、明确提供 reset state、没有 `last_reset_time` 或 `reset_run_id`，且 latest Run ID
仍等于候选 root。starter 只返回该已验证 Run ID，reconciler 只能持久化它，不能从空 Run ID 的
Describe 结果另选绑定对象。无法 Describe、Run ID 为空、reset state 缺失或任一条件未确认时保持
启动命令可重试，不能伪造已确认状态。

reconciler 在调用 `StartWorkflowExecution` 前，必须用当前 start lease token 在持久命令上原子置位
`dispatch_attempted`。取消先提交时该写入失败且不能发送 RPC；dispatch fence 先提交时，即使进程在
RPC 前退出，也必须按“可能已经投递”处理。`attempt_count` 只表示租约次数，不能证明是否发起过 RPC。
只有 `dispatch_attempted=false` 的本地输入校验失败才可使用
`workflow_start_not_dispatched_invalid`；此前可能投递过的命令即使后来校验失败也必须保留载荷。

若进程恰好在提交 dispatch fence 后、发送启动 RPC 前退出，取消会留下
`dispatch_attempted=true`、start 已 `superseded`、尚无 Temporal Run ID 的状态。Describe 确认
`NotFound` 后，reconciler 使用原 canonical workflow input 调用 recovery starter；starter 复用相同
Workflow ID 与 Memo，并以当前固定一分钟的 `StartDelay` 创建或取得 root execution。它必须完成
exact/latest 双 Describe 和完整身份校验，reconciler 才能首写绑定该精确 Run ID，随后走普通的
exact-run 取消路径。延迟只为绑定和取消保留窗口，不能把 recovery execution 当作 successor，也不能
以空 Run ID 取消 latest execution。

每次启动在 Temporal Memo 固化 `campus_agent_workflow_id`、`campus_agent_run_id`、
`campus_agent_payload_sha256` 和 `campus_agent_input_sha256`。reconciler 只有在这四项完整且与持久
启动命令一致时才确认已有执行；visibility 暂不可读、Memo 缺失或尚不可解码都保持可重试。明确
不一致时，run 与启动命令失败关闭，且不得取消该未知所有权的 Temporal execution。

取消由 app-api 先提交产品侧取消发件箱，再投递 execution-control。execution-control 将
`cancel_requested` 与 Temporal 取消命令持久化后由 reconciler 投递；临时网络错误只推进命令重试，
不丢失用户意图，也不直接伪造已取消终态。取消投递同样先校验上述 Memo：身份暂不可确认时重试；
明确冲突时只完成本地产品取消，不向不属于该 run 的 execution 发送取消。reconciler 每次操作已绑定
execution 前都要重新 Describe 精确 Run 与 latest Run；两者必须仍是同一个 root Run ID、Memo 一致、
reset state 已知且没有 reset evidence。最终只使用该持久绑定的具体 Run ID 取消，不能用空 Run ID
取消 latest execution，也不能把不同 latest 当作 successor 跟随。

Temporal 的 `first_run_id` 是 execution chain 标识；官方定义的同一 chain 包含
Continue-As-New、Workflow Retry、Cron 和 Reset，因而“相同 `first_run_id`”不能排除 Reset。当前在线
回答没有 Workflow RetryPolicy、Cron 配置或 Continue-As-New 路径，不支持任何 successor；若未来引入，
必须先设计新的持久 chain binding 与产品生命周期合同，不能自动放宽为按 `first_run_id` 跟随。参见
[Temporal Workflow ID、Run ID 与 Chain ID](https://docs.temporal.io/workflow-execution/workflowid-runid)。
启动命令一旦持久化 `dispatch_attempted=true`，Describe 返回 `NotFound` 也只能
表示启动身份未决，不能按固定时间窗口推断“从未启动”。已进入上述 superseded、无 Run ID 的取消
恢复条件时必须创建或取得 delayed recovery root；其他情况保持命令重试。只有
`dispatch_attempted=false` 且没有 Temporal Run ID 时，才允许在没有 execution 的情况下完成本地取消。

## 执行输入所有权

app-api 为已经分配 run 的产品请求保留完整执行输入及其 hash，产品终态不会改变这份数据。
execution-control 只保存 ref/hash，不维护输入清理发件箱，也不在 Workflow、Activity 或 reconciler
中调用删除接口。执行输入随 app-api 的会话和用户数据生命周期删除。

当前在线回答不支持 Temporal Reset。Activity、取消和超时收敛始终使用持久绑定的精确 root Run ID；
Reset 或其他 successor 不能改写产品终态或被重新绑定到原产品 run。

## Temporal poller

- workflow poller：`campus-agent.workflow.v3`；
- core activity poller：`campus-agent.activity.core.v3`；
- agent activity poller：`campus-agent.activity.agent.v3`。

三个 poller 与执行 HTTP API 运行在同一个 `execution-control` 进程。不存在独立的
knowledge/tool/retrieval/specialist worker；`agent-runtime` 仍是独立 Deployment。

## Agent Activity

execution-control 提供运行标识、已冻结执行策略、已准入的模型可见工具、本轮
`grounding_context.v2`、供应商配置和有界会话上下文。agent-runtime 返回结构化终态、真实 SDK
工具摘要、用量和 trace 关联。

SDK `maxTurns` 只限制该 run 的代理与工具轮次，不是重试次数、重新规划预算或新的 Temporal
阶段。内部 SDK 工具在 Agent Activity 生命周期内调用带认证的 execution-control 查询接口。

每个 source-side Temporal Activity 在读取 run 或写入任何投影前，都从当前 Activity context 取得
Workflow ID 与精确 Temporal Run ID，并与持久 start intent 的 Workflow ID 和 root Run ID 绑定逐项
比较。root 绑定尚未确认时返回可重试失败；Workflow ID 或 Run ID 不同，包括 Reset 产生的 successor，
都返回非重试身份失败。start 已 `superseded` 时，只有 cancellation finalizer 可以继续使用已绑定的
root execution，Agent、查询和普通 Finalization Activity 都必须停止。该 fence 不能只信任 Workflow
input 中携带的产品 run ID。

Primary Agent Activity 的 Temporal `MaximumAttempts` 为 `0`，允许在 workflow 生命周期内重试
Activity 调度和投影修复，但供应商调用仍然只能开始一次。Activity 在调用供应商前计算 canonical
provider invocation envelope 的摘要并写入 invocation receipt；只有 receipt 不存在时可进入首次调用。
receipt 为 `started` 或 `completed` 时都不能重放模型调用或从 PostgreSQL 复原模型正文，而是以
`agent_attempt_uncertain` 失败关闭。该约束承认 Activity dispatch 和外部模型 API 之间不存在原子
事务。

provider invocation envelope 的摘要是 receipt 的输入 fingerprint。它绑定 execution input、完整
admission snapshot、可见工具、最终模型上下文，以及实际发送给 agent-runtime 的精确 HTTP body；请求
摘要和网络发送复用同一份编码 bytes。completed receipt 只保存该输入摘要、Agent result ref 和 schema
version，不保存模型结果。`agent.primary` StepResult 保存有界摘要和正文 hash；完整 Agent result 仅由
workflow 的 Activity result 交给 Finalization。

## 取消、超时与终态处理

Temporal cancellation 和 activity deadline 必须传播到 agent-runtime 以及进行中的
供应商或内部查询调用。workflow 收到取消后使用 `workflow.NewDisconnectedContext` 执行有界、
可重试的终态持久化，再结束为 canceled；不能因为原 workflow context 已取消而跳过 closeout。

app-api 产品行和 `finalization_fingerprint` 是跨系统终态裁决。execution-control 只有在产品终态
被幂等接受后才发布相应浏览器终态；终态投影区分取消、超时、失败关闭和较晚完成，较晚成功不得
覆盖已经提交的产品终态。

reconciler 将 Temporal 的 `COMPLETED`、`FAILED`、`CANCELED`、`TERMINATED`、
`CONTINUED_AS_NEW` 和 `TIMED_OUT` 全部视为 closed。若对应产品 run 仍是活动状态，必须在身份可验证
后收敛为产品终态：超时投影为 `expired`，终止投影为失败，缺少 canonical 产品终态的完成、失败或
取消也失败关闭；`CONTINUED_AS_NEW` 或任何不同 latest Run 表示不受支持的 successor，产品 root run
以 `workflow_successor_without_authorization` 失败关闭。该路径不得把 successor 绑定到产品 run，也
不得向 successor 发送取消。visibility 或身份暂不可验证时继续重试，不能
留下一个已确认 closed 但永久 active 的产品 run，也不能靠猜测写终态。

在线回答在启动时设置 Temporal `WorkflowExecutionTimeout`。Temporal 报告 `TIMED_OUT` 后，
reconciler 以有界游标分页扫描已确认的活动 run，先查询持久化 Temporal Run ID 对应的精确
execution，再查询同 Workflow ID 的 latest execution；只有两次查询仍指向同一个 root Run ID、
Memo 一致、reset state 已知且没有 reset evidence，并确认该 execution 超时后，才依次写入 workflow step timeout；
单条 visibility 或身份错误不能阻塞后续页。随后
提交 app-api 产品终态，再以同一事务写入 `expired` 状态、`run_timeout` 原因、浏览器可见的
`run.expired` 事件并释放 conversation active-run 锁。产品回调失败时保持原活动状态重试；终态事件
写入冲突时整个投影事务回滚，不能留下缺少 `run.expired` 的半终态。产品终态不清空 app-api
持有的执行输入。

Finalization 执行确定性校验：

- 校验 workflow 传入的 Agent result 身份、冻结准入快照、grounding 绑定和完整有界 payload；
- 校验终态 schema 和允许的结果；
- 根据绑定当前 run 的 grounding context 校验 `evidence://` 引用；
- 从 grounding 的可信 metadata 生成浏览器可用来源；
- 拒绝缺失、伪造或跨目标依据；
- 通过一次 `FinalizeRunProjection` CAS 提交 completed `finalization.write` Step、Attempt、Result 与
  completed run 四元组；内存实现使用同一临界区，PostgreSQL 实现使用同一个持有 run row lock 的事务，
  任一校验或写入失败都不得留下半终态；
- 同一 CAS 释放 conversation active-run lock，并把已经存在的 pending 或 leased cancellation 收敛为
  `confirmed`、`last_error_code=completion_won`。完成事务先提交时 completion 获胜；取消终态先提交时
  Finalization 不得覆盖它。

Finalization 不调用 LLM、不生成第二个答案、不改写 SDK 答案；app-api 也不改写。
completed run 的重放必须严格核对 `CompletedAt`、`TerminalReason`、`FinalResponseRef`、
`finalization_fingerprint_sha256` 以及唯一且内部一致的 canonical Step/Attempt/Result，
随后返回已提交四元组。它不得写入较晚 candidate，不得修改 canonical 四元组、取消命令或可能属于后续
run 的 conversation lock；CAS 外只允许幂等补充后续 `run.completed` 事件。

## 流式传输与容量

浏览器流式传输订阅有界 run event。HTTP 连接生命周期不拥有执行生命周期；
重新连接读取持久事件投影和当前运行状态，不启动另一条执行路径。

事件读取使用 execution-control 返回的 `next_sequence` 推进，即使这一段序列只有内部事件而没有
浏览器可见 event。`request.accepted` 只确认产品请求和稳定 run 已持久化，不代表 Temporal 已
排队；`run.canceled` 则是浏览器可见的持久终态。

execution-control 根据运行就绪状态、策略和下游预算接纳新 run。进程内 limit 只是单进程保护，
Temporal task queue 与 worker 扩缩容共同定义部署容量。缺少 Temporal、
投影、供应商、内部查询、目标注册表或可信依据时拒绝接收或终结运行。

## 禁止形态

- 每个 SDK tool/specialist 一个 Temporal activity 或 queue；
- 独立知识 Agent worker；
- 确定性 workflow 代码选择语义工具；
- 将每个检索查询、候选处理、重排、SDK tool call 或模型轮次展开成 Temporal activity graph；
- 从 SDK 轮次派生持久重新规划状态；
- app-api 或 finalization 改写答案；
- 把冻结输入正文放入 execution-control metadata、Temporal history、event、step、日志或 trace；
- 为旧版本请求保留执行合同、双读、双写或失败回退；
- 已索引知识回退到实时公网搜索。

## 相关文档

- `agent-framework.md`
- `k8s-runtime.md`
- `memory-plane.md`
- `../../contracts/app-api/request-lifecycle.md`
- `../../contracts/tool-execution.md`
- `../../data/durable-runtime.md`
- `../../runbooks/execution.md`
- `../../runbooks/temporal.md`
- `../../reference/agent-orchestration.md`
