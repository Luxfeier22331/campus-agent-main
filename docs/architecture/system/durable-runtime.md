---
doc_type: architecture
owner_boundary: execution-control
status: active
---
# 持久 Agent 运行时

## 文档边界

本文定义在线回答的持久生命周期。这里的 Agent Workflow 是产品编排概念；Temporal Workflow 是其
持久化实现，负责 workflow history、task queue、retry、timer 和 activity dispatch。execution-control
负责执行准入、四类 operation 的顺序、重规划预算、命令投递和有界投影；OpenAI Agents SDK 负责某个
operation 内的模型与工具循环。app-api 拥有产品请求、原始执行输入和跨系统产品终态。

## 主要对象

- `Conversation`、`Turn`：app-api 产品事实；
- `Run`：产品可见持久执行对象；
- `Agent Workflow`：Solve（直接回答或生成计划）→Execute Step→Replan→Synthesize 的产品编排；
- `ToolExecutionWorkflow`：上述 Agent Workflow 的 Temporal Workflow 实现；
- `WorkflowStartCommand`、`CancellationCommand`：将已提交的 PostgreSQL 意图投递给 Temporal
  的持久命令；
- `AgentInvocationReceipt`：约束同一模型 operation 的供应商调用只能开始一次；
- `RunEvent`、`RunStep`、`StepAttempt`、`StepResult`：有界投影，不是 workflow
  history；
- `Finalization`：app-api 消费的已验证终态投影。

PostgreSQL 保存产品读取、运维和评测所需的有界投影，不是执行队列或 Temporal history 副本。

## 实现所有权

- `internal/execution` 定义中立执行合同、admission 校验和 workflow identity，不依赖
  Temporal SDK、HTTP 或 PostgreSQL driver；
- `internal/executionapplication` 负责构造冻结 workflow input、原子提交 run/start intent、提交取消命令，
  并拥有 run/receipt/memory、workflow control 和 outbound ports，执行 receipt 状态管理、Campus Docs
  与个人记忆工具用例；具体工具合同文件读取由 `internal/toolcontract` 实现注入端口；
- `internal/httpapi` 只完成认证、wire 解码、错误映射和响应编码，不拥有执行生命周期、admission、检索
  query 或 recall request 规则；
- `internal/executionreconciler` 通过 application starter/control/finalizer 合同收敛持久命令；
- `internal/temporaladapter/execution`、`memory`、`finalization` 分别拥有实际 activity 实现，
  `finalization/projection` 通过 application RunStore 写投影；`contract` 负责独立 workflow DTO 与领域合同转换；
- `internal/runtimeassembly` 是唯一生产 composition root，创建 Temporal client、starter 和 worker，
  注册 workflow/activity 并组装 application ports；
- `internal/campusdocs` 定义索引和搜索合同，PostgreSQL 当前索引读取由
  `internal/campusdocspersistence` 实现，embedding、Qdrant 与 reranker wire 调用由
  `internal/outboundadapter` 实现。

## 进程停机

`execution-control` 收到停机信号后先进入 draining，禁止新的 HTTP 业务请求；已进入的请求在有界的
`ShutdownGraceMS` 窗口内继续使用尚未关闭的 runtime 和 store。HTTP listener 完成 shutdown 或超时
强制关闭后，进程才停止 reconciler 与 Temporal poller，最后关闭共享数据库和 Temporal client。
停机不会删除或伪造已持久化的 workflow start/cancellation intent；未完成命令由下一实例继续租约和收敛。

## 执行阶段

1. **Solve**：在 agent queue 调用 `apps/agent-runtime`，直接回答简单请求或生成有界任务计划；
2. **Execute Step**：按依赖逐步调用 `apps/agent-runtime`，由 Executor 执行当前步骤允许的来源并保留
   成功证据、`no_match` 和失败状态；
3. **Replan**：在步骤完成后调用 `apps/agent-runtime`，由 Replanner 决定继续、修改剩余步骤或进入合成；
4. **Synthesize**：聚合成功证据后调用 `apps/agent-runtime` 生成最终正文；
5. **Finalization**：在 core queue 校验 operation 结果、生成终态投影并写入最终投影；
6. **Memory Append**：在 core queue 提交有界的回答后记忆追加。

Temporal 不把 SDK tool call 展开成独立 Temporal 阶段，但 Agent Workflow 的 Solve、Execute Step、Replan
和 Synthesize 是真实的持久步骤。当前在线 workflow 不包含独立的强制预检索阶段；离线 Campus Docs
制品发布不进入 Temporal history。

PostgreSQL 正式步骤投影保存 ref、hash、用量和终态等摘要；invocation receipt 另保存完整类型化
operation output，用于 Activity 重投递时恢复结果和修复投影。

`personal_memory_recall` 不建立独立载荷。它的完整返回值是当前 operation 有界 result 的一部分；模型
operation invocation receipt 约束该 operation 的模型和工具调用只能开始一次。started receipt 的
结果不确定时阻断；completed receipt 使用已保存结果恢复，不再次调用 Provider。
精确绑定字段和 StepResult 写入边界见 `../../data/durable-runtime.md`。

## 启动与取消命令

execution-control 的 application service 在同一事务写入 run 与 workflow 启动命令，然后 HTTP adapter
即可把稳定 run 返回给 app-api。后台 reconciler 租约并幂等投递命令，因此 API 响应、进程退出或
Temporal 返回不确定时都不会要求删除 run 或猜测 workflow 是否已启动。

每个在线回答固定使用 `campus-agent.chat.{requestId}` 作为 Workflow ID。与仍开放的同 ID workflow
冲突时使用 `USE_EXISTING`，关闭后重放使用 `REJECT_DUPLICATE`；reconciler 读取已有执行并确认
Temporal Run ID，而不是创建第二个 workflow。Workflow 输入只包含关联标识、输入 ref/hash、有界
策略版本和执行预算，不包含 prompt、会话正文、认证投影或完整工具载荷。

Temporal 返回 `WorkflowExecutionAlreadyStarted` 只表示同 Workflow ID 已存在，不能直接确认本次
启动成功。starter 必须取得 `ExecuteWorkflow` 返回的具体 Run ID，或
`WorkflowExecutionAlreadyStarted.RunId`，再 Describe 该精确 execution。精确 execution 必须是
`first_run_id` 等于自身 Run ID 的 root，并通过完整 Memo 校验、明确提供 reset state、没有
`last_reset_time` 或 `reset_run_id`。latest 改变不阻断该精确 root 的绑定；successor 不属于本产品
run。starter 只返回该已验证 Run ID，reconciler 只能持久化它，不能从空 Run ID 的
Describe 结果另选绑定对象。无法 Describe、Run ID 为空、reset state 缺失或任一条件未确认时保持
启动命令可重试，不能伪造已确认状态。普通 starter 与 recovery starter 都返回已验证的精确 root
Run ID；reconciler 负责持久绑定，不重复 starter 已完成的身份证明。

reconciler 在调用 `StartWorkflowExecution` 前，必须用当前 start lease token 在持久命令上原子置位
`dispatch_attempted`。该原子写入检查当前租约、活动 run 和取消意图，不在写入前另做租约预读。
取消先提交时该写入失败且不能发送 RPC；dispatch fence 先提交时，即使进程在
RPC 前退出，也必须按“可能已经投递”处理。`attempt_count` 只表示租约次数，不能证明是否发起过 RPC。
只有 `dispatch_attempted=false` 的本地输入校验失败才可使用
`workflow_start_not_dispatched_invalid`；此前可能投递过的命令即使后来校验失败也必须保留载荷。

若进程恰好在提交 dispatch fence 后、发送启动 RPC 前退出，取消会留下
`dispatch_attempted=true`、start 已 `superseded`、尚无 Temporal Run ID 的状态。Describe 确认
`NotFound` 后，reconciler 使用原 canonical workflow input 调用 recovery starter；starter 复用相同
Workflow ID 与 Memo，并以当前固定一分钟的 `StartDelay` 创建或取得 root execution。它必须完成
精确 Run ID Describe 和完整身份校验。reconciler 收到成功结果后首写绑定该精确 Run ID，再查询其
当前状态并走普通的 exact-run 取消路径，不在持久绑定前重复查询。延迟只为绑定和取消保留窗口，
不能以空 Run ID 取消未绑定的 execution。

每次启动在 Temporal Memo 固化 `campus_agent_workflow_id`、`campus_agent_run_id`、
`campus_agent_payload_sha256` 和 `campus_agent_input_sha256`。首次绑定只有在这四项完整且与持久
启动命令一致时才确认已有执行；visibility 暂不可读、Memo 缺失或尚不可解码都保持可重试。明确
不一致时，run 与启动命令失败关闭，且不得取消该未知所有权的 Temporal execution。

取消由 app-api 校验归属后调用 execution-control。execution-control 将
`cancel_requested` 与 Temporal 取消命令持久化后由 reconciler 投递；临时网络错误只推进命令重试，
不丢失用户意图，也不直接伪造已取消终态。尚无绑定时，取消路径先通过无 Run ID 的 Describe 发现候选，
再对该候选的精确 Run ID 校验 Memo、root 和 reset state；latest 只用于发现候选，不是绑定条件。身份未知时重试，Memo 明确冲突时只完成本地产品取消，
不向该 execution 发送取消。

绑定后，持久 Workflow ID/Run ID 是归属依据。取消和终态收敛只查询、操作该精确 execution，
不重建启动输入摘要，不重新证明 Memo、chain、reset state 或 latest 归属。Describe 返回的
Workflow ID/Run ID 必须与请求对象一致；取消 RPC 失败后也只复查同一个 execution。
取消前仍检查当前产品状态和持久绑定，完成与取消的竞争仍由已有终态事务裁决。
latest 改变不影响 root 按自身状态收敛；不重新绑定或取消其他 execution。

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

三个 poller 与执行 HTTP API 运行在同一个 `execution-control` 进程。不存在按知识类型、工具或检索
能力拆分的独立 worker；`agent-runtime` 仍是独立 Deployment。

## Agent Workflow operation

execution-control 为每个 operation 提供运行标识、当前步骤/计划、已准入的模型可见工具、历史配置槽位
`primary_agent` 的预期 Model Target hash 和有界会话上下文。Agent Runtime 从共同受信任的 Model Config
按预期 hash 读取实际供应商配置，再在真实 `AgentInputItem[]` 上执行字符预算裁剪，并返回 operation
结果、真实 SDK 工具摘要、证据、上下文用量、模型用量和 trace 关联。

plan、候选来源、依赖和 replan decision 的语义规则由 execution-control 的共享纯规则入口实现；Adapter
与 Temporal workflow 只在各自信任边界调用，不复制同一套语义实现。

SDK `maxTurns` 只限制当前 operation 的代理与工具轮次，不是重试次数或重规划预算。重规划次数和
步骤数量由外层 Agent Workflow 预算限制。内部 SDK 工具在当前 operation 生命周期内调用带认证的
execution-control 查询接口。
HTTP adapter 解码工具 envelope 后把 typed request 交给 `AgentToolService`；该 use case 校验 run 正在
执行、activity attempt 是当前 operation 的最新 attempt，且工具位于该 attempt 的已准入可见工具集合。
Campus Search 的检索表达式、当前索引读取和搜索调用，以及 personal-memory recall 的冻结 workflow
admission 校验、执行输入加载和 recall request 构造都不属于 HTTP owner。

每个 source-side Temporal Activity 在读取 run 或写入任何投影前，都从当前 Activity context 取得
Workflow ID 与精确 Temporal Run ID，并与持久 start intent 的 Workflow ID 和 root Run ID 绑定逐项
比较。root 绑定尚未确认时返回可重试失败；Workflow ID 或 Run ID 不同，包括 Reset 产生的 successor，
都返回非重试身份失败。start 已 `superseded` 时，只有 cancellation finalizer 可以继续使用已绑定的
root execution，Agent、查询和普通 Finalization Activity 都必须停止。该 fence 不能只信任 Workflow
input 中携带的产品 run ID。

Agent operation Activity 的 Temporal `MaximumAttempts` 为 `0`，允许在 workflow 生命周期内重试
Activity 调度和投影修复，但供应商调用仍然只能开始一次。Activity 在调用供应商前计算 canonical
provider invocation envelope 的摘要并写入 invocation receipt；只有 receipt 不存在时可进入首次调用。
receipt 为 `started` 时结果不确定，以 `workflow_attempt_uncertain` 阻断，不重新调用模型；
`completed` receipt 则解码已保存的 operation output，校验身份、修复投影后返回原结果。
恢复前严格检查字段、1 MiB 完整输出预算及已有 output hash。JSONB 读回后按类型化 DTO 重新编码校验，
不使用存储引擎的文本键序或空白；失败时不再次调用供应商。
已领取的 invocation 返回失败时，application receipt service 写入 `failed` 及有界错误码；后续投递
返回该失败，不再次执行供应商调用。进程在写入终态前退出时仍保留 `started`，按不确定结果处理。
该约束承认 Activity dispatch 和外部模型 API 之间不存在原子事务。

provider invocation envelope 的摘要是 receipt 的输入 fingerprint，绑定 request、step、operation、
invocation、execution input hash、admission snapshot hash 和逻辑请求摘要。逻辑请求摘要排除
`activity_attempt`；实际 HTTP 请求仍携带它来约束工具调用。它不是精确 HTTP bytes 的摘要，也不是
agent-runtime 后续加工后的最终模型输入摘要。
completed receipt 保存完整类型化 operation output、输出 hash 和完成时间，可能包含回答正文、证据及
工具结果；先完成 receipt，再写诊断投影，使 Activity 重投递能够恢复结果而不重复供应商调用。
各 operation 的 StepResult 仍保存有界摘要和正文 hash；receipt 是执行恢复载荷，不取代 app-api 的
产品答案所有权。独立 receipt store 负责记录与冲突检查，保留期限随父 run；内存 owner 在共享锁下删除，
PostgreSQL 通过外键级联删除，不另设 receipt TTL。
Runtime 拥有模型输出结构解析；workflow 拥有计划预算、图依赖和 replan decision 语义；adapter 拥有
身份、来源准入及恢复校验。Solve/Replan 各只传递一份类型化决策，workflow 自行构造 completed step；
Synthesis 的输入不重复 plan/completed steps，只传递回答所需的材料与剩余事实。
各传输与恢复边界的字节预算及无旧合同兼容的切换要求见
[执行合同](../../contracts/tool-execution.md#agent-结果传递)。
准入快照在 builder、持久输入解码和 Activity 边界校验，不与自身工具列表重复比较。

## 取消、超时与终态处理

Temporal cancellation 和 activity deadline 必须传播到 agent-runtime 以及进行中的
供应商或内部查询调用。workflow 收到取消后使用 `workflow.NewDisconnectedContext` 执行有界、
可重试的终态持久化，再结束为 canceled；不能因为原 workflow context 已取消而跳过 closeout。

app-api 产品行和 `finalization_fingerprint` 是跨系统终态裁决。execution-control 只有在产品终态
被幂等接受后才发布相应浏览器终态；终态投影区分取消、超时、失败关闭和较晚完成，较晚成功不得
覆盖已经提交的产品终态。

reconciler 将 Temporal 的 `COMPLETED`、`FAILED`、`CANCELED`、`TERMINATED`、
`CONTINUED_AS_NEW` 和 `TIMED_OUT` 全部视为 closed。若对应产品 run 仍是活动状态，按已绑定
execution 的状态收敛：超时投影为 `expired`，终止投影为失败，缺少 canonical 产品终态的完成、
失败或取消也失败关闭；取消命令观察到已取消 root 时沿用本地取消收口。
`CONTINUED_AS_NEW` 是当前产品不支持的关闭结果，以不可重试的 `runtime_invariant_failed` 收口，
不查找 successor，也不以 latest 是否改变决定产品终态。Describe 失败、NotFound 或缺少必要关闭
时间时保持重试，不猜测终态。已有产品终态不能被覆盖。

在线回答在启动时设置 Temporal `WorkflowExecutionTimeout`。Temporal 报告 `TIMED_OUT` 后，
reconciler 以有界游标分页扫描已确认的活动 run，只查询持久化 Temporal Run ID 对应的精确
execution；确认该对象超时且有关闭时间后，写入 workflow step timeout。
单条 Describe 失败或对象不匹配不能阻塞后续页。随后
提交 app-api 产品终态，再以同一事务写入 `expired` 状态、`run_timeout` 原因、浏览器可见的
`run.expired` 事件并释放 conversation active-run 锁。产品回调失败时保持原活动状态重试；终态事件
写入冲突时整个投影事务回滚，不能留下缺少 `run.expired` 的半终态。产品终态不清空 app-api
持有的执行输入。

Finalization 执行确定性校验：

- 校验 workflow 传入的 Agent result、执行输入摘要和完整有界 payload；
- 校验终态 schema 和允许的结果；
- 拒绝不属于当前终态合同的来源引用；
- 通过一次 `FinalizeRunProjection` CAS 提交 completed `finalization.write` Step、Attempt、Result 与
  completed run 四元组；内存实现使用同一临界区，PostgreSQL 实现使用同一个持有 run row lock 的事务，
  任一校验或写入失败都不得留下半终态；
- 同一 CAS 释放 conversation active-run lock，并把已经存在的 pending 或 leased cancellation 收敛为
  `confirmed`、`last_error_code=completion_won`。完成事务先提交时 completion 获胜；取消终态先提交时
  Finalization 不得覆盖它。

Finalization 不调用 LLM、不生成第二个答案、不改写 SDK 答案；app-api 也不改写。
`finalization.write` StepResult 只保存有界 `finalization_summary`、响应 hash 和引用计数；完整
`ExecutionFinalizationResponse` 保留在内部 `finalization.completed` event，供产品回调后的修复和
完成重放校验使用，不进入浏览器事件。新路径不写同名 browser-visible event；历史同名事件由 app-api
过滤。只有 `FinalizeRunProjection` 成功后的 `run.completed` 才是浏览器成功终态。
Finalization 在 callback 前先持久化 internal `finalization.reserved` event，绑定
`workflow_result_ref`、projection fingerprint、首次 durable `run.progress(finalizing)` 的
`started_at` 与 execution-control 生成的 wall-clock `completed_at`。重试必须复用 reservation 的
时间和身份；canonical Step/Result、run.CompletedAt、callback `completed_at` 与 `run.completed`
统一使用该 completion boundary。workflow DTO 不再保留旧 `FinalizedAt` 字段或 history 兼容分支；
离线 replay fixture 直接由当前生产 workflow 生成。
completed run 的重放必须严格核对 `CompletedAt`、`TerminalReason`、`FinalResponseRef`、
`finalization_fingerprint_sha256` 以及唯一且内部一致的 canonical Step/Attempt/Result，
随后返回已提交四元组。它不得写入较晚 candidate，不得修改 canonical 四元组、取消命令或可能属于后续
run 的 conversation lock；CAS 外只允许幂等补充后续 `run.completed` 事件。若产品成功证据已经存在但
projection CAS 冲突，失败收口必须停止在 `finalization_projection_conflict`：不重复发送产品错误
callback，也不发布 `run.failed`。只有同一 fingerprint/identity 的重放可以自动修复；canonical 记录
歧义或不完整时保持 active 并 fail-closed，交由明确诊断和人工修复路径处理。

## 流式传输与容量

浏览器流式传输订阅有界 run event。HTTP 连接生命周期不拥有执行生命周期；
重新连接读取持久事件投影和当前运行状态，不启动另一条执行路径。

事件读取使用 execution-control 返回的 `next_sequence` 推进，即使这一段序列只有内部事件而没有
浏览器可见 event。`request.accepted` 只确认产品请求和稳定 run 已持久化，不代表 Temporal 已
排队；`run.canceled` 则是浏览器可见的持久终态。

app-api 只把持久事件投影为固定产品事件：排队、开始执行、阶段变化、答案增量和请求终态。阶段变化
只公开 `preparing`、`generating`、`finalizing`；Temporal Activity、SDK 工具调用、attempt/result、
worker 和 task queue 不进入 Campus Web。回答过程读取同一事件时间线，固定派生 `queued`、
`preparing`、`generating`、`finalizing` 四个协议步骤及其时间，不透传原始步骤轨迹。

execution-control 根据运行就绪状态、策略和下游预算接纳新 run。进程内 limit 只是单进程保护，
Temporal task queue 与 worker 扩缩容共同定义部署容量。缺少 Temporal、
投影、供应商、内部查询、目标注册表或可信依据时拒绝接收或终结运行。

## Workflow completion budget

产品 `completed` 与 Temporal root workflow close 是两个有意分开的观察点。Finalization CAS
成功后，产品答案已经 canonical；随后个人记忆追加仍作为非关键 side effect 在 core activity queue
执行。当前 workflow 会等待该 activity 的既有 timeout/retry 收敛，再返回 workflow result；append
失败不能回滚已提交的产品答案，也不能重复追加已完成 run。当前不引入 detached child workflow、
outbox 或第二套 memory store。该同步等待是现行合同，不表示产品客户端必须等待 memory append。

Workflow 的 900 秒 `WorkflowExecutionTimeout` 是硬生命周期上限。Agent operation 的 deadline、
plan/replan 次数、activity timeout/retry、finalization 和 memory append 都受该上限约束；它们不是
保证一定消耗的时间额度。达到硬上限时由 Temporal timeout/reconciler 以 `expired` 收口，不能把
`agent_deadline_exceeded`、`workflow_attempt_uncertain` 或取消伪装成同一错误。App API 的 durable
polling `maxAttempts` 是连续空页预算，不是严格 elapsed-time SLA；一旦观察到 terminal event，
应立即返回，不再等待后续 workflow close。修改任一 operation 或 polling 默认值时，必须重新核对
这张预算关系和终态优先级。

## 禁止形态

- 每个 SDK 工具或语义能力一个 Temporal activity 或 queue；
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
