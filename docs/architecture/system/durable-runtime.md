---
doc_type: architecture
owner_boundary: agent-control
status: active
---
# 持久 Agent 运行时

## 文档边界

本文定义在线回答的持久生命周期。agent-runtime 的 TypeScript Temporal Workflow 拥有 Solve、
Execute、Replan、Synthesize 顺序和预算，单次模型请求与外部工具调用分别作为 Activity。
agent-control 拥有执行准入、启动/取消命令、运行载荷、事件和终态投影；app-api 拥有产品请求、
原始输入和产品终态。Memory 是独立 API、Worker、Workflow 与数据库，通过 API 接收召回和管理请求。

新运行固定进入 TypeScript AgentWorkflow。旧 Go Workflow、Worker 和 HTTP Runtime 已归档为
非编译源码，不提供旧 history 支持。数据库身份与 Temporal 队列等持久身份保持不变。

## 主要对象

Executor 步骤状态与检索材料是否可用分别表达：`model_output_invalid` 表示步骤总结的结构化输出
失败，不否定已经成功执行的工具。Runtime 返回完整失败结果，Execution Control 复用来源检查并保存
失败 receipt；Workflow 保留步骤失败、材料和来源尝试，再按既有剩余步骤/Replanner/Synthesizer 流程
收敛。不制造成功摘要，不重跑失败 operation，不放宽所有 `run_failed`；取消、截止时间和终态仍优先。

- `Conversation`、`Turn`：app-api 产品事实；
- `Run`：产品可见持久执行对象；
- `Agent Workflow`：Solve 直接回答，或进入 Execute Step、按需 Replan 与 Synthesize 的产品编排；
- `AgentWorkflow`：TypeScript Temporal Workflow，负责全部新 Agent 运行；
- `WorkflowStartCommand`、`CancellationCommand`：将已提交的 PostgreSQL 意图投递给 Temporal
  的持久命令；
- `AgentInvocationReceipt`：约束同一模型调用只能开始一次，保存已完成结果供恢复；
- `RunEvent`、`RunStep`、`StepAttempt`、`StepResult`：有界投影，不是 workflow
  history；
- `Finalization`：app-api 消费的已验证终态投影。

PostgreSQL 保存产品读取、运维和评测所需的有界投影，不是执行队列或 Temporal history 副本。

## 实现所有权

- `internal/execution` 定义中立执行合同、admission 校验和 workflow identity，不依赖
  Temporal SDK、HTTP 或 PostgreSQL driver；
- `internal/executionapplication` 负责构造冻结 workflow input、原子提交 run/start intent、提交取消命令，
  并拥有 run/receipt、workflow control 和执行 outbound ports，负责 receipt、运行内工具身份校验
  和账号删除协调；`operation` 负责输入准备、结果归一化与事件投影，`finalization` 统一处理回答终态
  和恢复，`projection` 负责业务投影；具体工具合同文件读取由 `internal/toolcontract` 实现注入端口；
- `apps/agent-runtime/src/workflows.ts` 拥有 Agent 推进，`activities.ts` 执行模型和工具，
  `domain-tools.ts` 直接调用 Search/Memory API；`internal/runtimeapi` 是 control 的类型化读写入口；
- `apps/memory-service` 拥有记忆管理、命令与追加恢复、provider adapter 和生命周期状态，
  不依赖 execution run 或产品消息；
- `internal/httpapi` 只完成认证、wire 解码、错误映射和响应编码，不拥有执行生命周期、admission、检索
  query 或 recall request 规则；
- `internal/executionreconciler` 通过 application starter/control/finalizer 合同收敛持久命令；
- `internal/executioncontract` 拥有 operation 数据和投影准入规则；Runtime 通过 typed API 提交结果；
- `internal/runtimeassembly` 是 Control API 的生产 composition root，装配 Temporal client、starter、
  reconciler 和 Memory dispatcher，不注册 Workflow 或 Activity，也不装配 Hindsight；

- `apps/campus-search` 独立拥有检索实现，Agent 的工具 Activity 通过 API 消费。

## 进程停机

`agent-control` 收到停机信号后先进入 draining，禁止新的 HTTP 业务请求；已进入的请求在有界的
`ShutdownGraceMS` 窗口内继续使用尚未关闭的 runtime 和 store。HTTP listener 完成 shutdown 或超时
强制关闭后，API 才停止 reconciler，最后关闭共享数据库和 Temporal client。
独立 `agent-runtime-worker` 先撤销 readiness，再停止三类 poller，最后关闭连接和遥测资源；
停止 API 不会停止 Worker，扩容 API 不会增加 poller。具体退出上限与探针见执行模块 README。
停机不会删除或伪造已持久化的 workflow start/cancellation intent；未完成命令由下一实例继续租约和收敛。

## 执行阶段

1. **Solve**：由 TypeScript Workflow 调度模型与工具 Activity，可使用已准入检索来源直接回答简单请求，或生成有界任务计划；
2. **Execute Step**：按计划顺序选择首个依赖已完成的步骤，等待当前步骤结束后再选下一步，由 Executor 执行当前步骤允许的来源并保留
   成功证据、`no_match` 和失败状态；
3. **Replan**：步骤存在 `remainingFacts`、可恢复失败，或没有 evidence 且来源失败/无匹配时，
   还需满足计划与重规划预算未耗尽、仍有后续执行或来源路径，才调用 Replanner 决定继续、替换剩余步骤或进入合成；
4. **Synthesize**：计划结束后，在有 evidence、成功来源尝试（包括 `no_match`）或明确来源不可用结果时，
   使用已有材料生成正文；无可用材料且只有其他技术失败时保持失败；
5. **Finalization**：Activity 通过 control API 校验并提交产品终态与运行投影；
6. **Memory Append**：control 投递表在完成事务中置为 ready，交付独立 Memory API 后由其 Workflow 推进。

Solve 返回合法答案时直接进入 Finalization，不调用 Execute Step、Replan 或 Synthesize。
Solve 失败但保留 evidence 时，使用独立的 recovery synthesis 分支；计划中的可恢复步骤失败保留材料，
继续既有步骤、按需重规划并按计划合成。取消、绝对截止时间和不可恢复失败仍结束运行。
实际分支见 [TypeScript Workflow](../../../apps/agent-runtime/src/workflows.ts)。
模型轮次与外部工具调用分别持久调度；检索服务内部的 embedding、候选排序等仍由检索服务完成。
有界步骤投影与 Runtime continuation 分开存储；完整 prompt、工具结果不放进 Temporal history。
模型结果已保存时复用 receipt，已开始但结果未知时使用 `workflow_attempt_uncertain` 收口。

## 启动与取消命令

agent-control 的 application service 在同一事务写入 run 与 workflow 启动命令，然后 HTTP adapter
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

取消由 app-api 校验归属后调用 agent-control。agent-control 将
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
agent-control 只保存 ref/hash，不维护输入清理发件箱，也不在 Workflow、Activity 或 reconciler
中调用删除接口。执行输入随 app-api 的会话和用户数据生命周期删除。

当前在线回答不支持 Temporal Reset。Activity、取消和超时收敛始终使用持久绑定的精确 root Run ID；
Reset 或其他 successor 不能改写产品终态或被重新绑定到原产品 run。

## Temporal poller

agent-runtime Worker 注册 `campus-agent.agent.workflow.v1`、`campus-agent.agent.model.v1` 和
`campus-agent.agent.tool.v1`。同一个进程拥有三类 poller，不按模型或工具单独部署 Worker。
Memory 使用自己的 Worker 和 Workflow；Control 只持有 Temporal client，不运行 poller。

## 模型与工具 Activity

Workflow 调度单次模型调用和单次本地函数调用。Runtime 从 Control 读取冻结输入，通过 Model Config
解析匹配目标的凭据，再执行模型请求；工具 Activity 直接调用 Search/Memory API。供应商 continuation
由 Control 作为载荷持久化，Temporal history 只携带引用和有界决策。

Control typed API 校验精确 Workflow/Run 身份，拥有 receipt、输入输出载荷、结果归一化与投影。
模型调用先读取 receipt；已完成时直接恢复，已开始但结果未知时返回不确定结果，不能重新调用模型。
新调用先领取 receipt，返回后先保存结果再推进投影。Activity 重试可修复投影，不承诺外部模型的
exactly-once 执行。工具 Activity 保持冻结准入、工具预算和引用合同。

Solve 转为计划时保留已有 evidence/source attempts；失败且已获得材料时允许 recovery synthesis。
恢复不重新检索、不重置 deadline，已有正文片段由最终答案替换。个人记忆仅作为辅助上下文，
召回失败沿用原工具失败合同，append 位于产品最终化之后。

## 取消、超时与终态处理

Temporal cancellation 和 activity deadline 必须传播到 agent-runtime 以及进行中的
供应商或内部查询调用。workflow 收到取消后使用 `CancellationScope.nonCancellable` 执行有界、
可重试的终态持久化，再结束为 canceled；不能因为原 workflow context 已取消而跳过 closeout。

app-api 产品行和 `finalization_fingerprint` 是跨系统终态裁决。agent-control 只有在产品终态
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
`started_at` 与 agent-control 生成的 wall-clock `completed_at`。重试必须复用 reservation 的
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

事件读取使用 agent-control 返回的 `next_sequence` 推进，即使这一段序列只有内部事件而没有
浏览器可见 event。`request.accepted` 只确认产品请求和稳定 run 已持久化，不代表 Temporal 已
排队；`run.canceled` 则是浏览器可见的持久终态。

app-api 只把持久事件投影为固定产品事件：排队、开始执行、阶段变化、答案增量和请求终态。阶段变化
只公开 `preparing`、`generating`、`finalizing`；Temporal Activity、SDK 工具调用、attempt/result、
worker 和 task queue 不进入 Campus Web。回答过程读取同一事件时间线，固定派生 `queued`、
`preparing`、`generating`、`finalizing` 四个协议步骤及其时间，不透传原始步骤轨迹。

agent-control 通过执行输入和 admission snapshot 校验准备新 run，将 run 与 start intent 持久化后
交由 reconciler 启动 Temporal workflow。HTTP server 不维护本地执行限流队列或执行 registry；
admission snapshot 描述本轮能力和预算，不承担并发控制。实际执行容量由 Temporal task queue 和
worker 配置约束，HTTP 请求排空与持久执行生命周期分别由 API 进程和执行层负责。缺少 Temporal、
投影、供应商、内部查询、目标注册表或可信依据时拒绝接收或终结运行。

## Workflow completion budget

产品 `completed` 与 Temporal root workflow close 是两个观察点。control 在产品终态确认后，
与运行完成同一事务将准备好的 Memory 投递标为 ready，dispatcher 交付独立 Memory API。
Memory 接收时原子保存完整最小输入与派发意图；回答 Workflow 不等待记忆内容处理完成。
Memory 接收后的恢复不读取 execution run、finalization 或产品消息，追加失败不回滚产品答案。
旧本地 Memory 模式仍由 `MemoryAppendWorkflow` 与 `answermemory` 消费，待排空后退役。

Workflow 的 900 秒 `WorkflowExecutionTimeout` 是硬生命周期上限。Agent operation 的 deadline、
plan/replan 次数、activity timeout/retry、finalization 和 memory append 都受该上限约束；它们不是
保证一定消耗的时间额度。达到硬上限时由 Temporal timeout/reconciler 以 `expired` 收口，不能把
`agent_deadline_exceeded`、`workflow_attempt_uncertain` 或取消伪装成同一错误。App API 的 durable
polling `maxAttempts` 是连续空页预算，不是严格 elapsed-time SLA；一旦观察到 terminal event，
应立即返回，不再等待后续 workflow close。修改任一 operation 或 polling 默认值时，必须重新核对
这张预算关系和终态优先级。

## 禁止形态

- 按知识类型或语义工具各建一个 Worker/queue；模型、工具各用统一队列；
- 独立知识 Agent worker；
- 确定性 workflow 代码选择语义工具；
- 将检索服务内部的候选处理、embedding、重排拆成 Agent Workflow Activity；
- 从 SDK 轮次派生持久重新规划状态；
- app-api 或 finalization 改写答案；
- 把冻结输入正文放入 agent-control metadata、Temporal history、event、step、日志或 trace；
- 为旧版本请求保留执行合同、双读、双写或失败回退；
- 已索引知识回退到实时公网搜索。

## 相关文档

- [Agent 框架](./agent-framework.md)
- [Kubernetes 运行时](./k8s-runtime.md)
- [个人记忆](./memory-plane.md)
- [聊天请求生命周期](../../contracts/app-api/request-lifecycle.md)
- [执行合同](../../contracts/tool-execution.md)
- [持久执行数据](../../data/durable-runtime.md)
- [执行服务运维](../../runbooks/runtime/execution.md)
- [Temporal 自托管运维](../../runbooks/runtime/temporal.md)
- [Agent 编排研究参考](../../reference/agent-orchestration.md)
