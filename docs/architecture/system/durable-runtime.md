---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-04
updated: 2026-06-28
---
# Durable Agent Runtime Architecture

## 文档边界

本文冻结 `campus-agent` 长期 production agent runtime 的 durable execution
supporting architecture。

它回答的是：

- 一次用户回答的 canonical execution object 是什么
- conversation、run、event、Temporal workflow、task queue 与 worker pool 的长期关系是什么
- production 并发预算、排队、取消、恢复、step execution 与 streaming 应由哪一层拥有
- `execution-control`、Temporal workflow worker、activity worker pool 与 worker autoscaler
  如何分层

它不负责：

- 具体 database schema、migration 文件或执行顺序
- 一次部署证据是否已经覆盖 production topology
- 某个 worker pool 的机器规格或具体 autoscaling 阈值
- eval、retrieval、ingestion 的 collection-specific release 细节

accepted merged truth 仍以 `docs/architecture/current.md` 为准。本文描述的是
supporting architecture；实现状态必须单独写在 current architecture 或 owning
operational artifact 中。

## Core Conclusion

`campus-agent` 的 production execution model 固定为：

`surface request -> app-api surface / account projection -> durable conversation
and run projection -> execution-control -> Temporal workflow -> task queues ->
workflow / activity worker pools -> typed step results -> sanitized run event +
step / attempt / result projection -> app-api stream / projection / operator read
model -> browser surface / Operator Console / eval / badcase`

核心规则：

- HTTP request 不等于 agent execution lifetime。
- `run_id` 是一次回答的 canonical execution object。
- `conversation_id` 是上下文、account / session、memory binding 与同会话并发策略的边界。
- `run_events` 是 streaming、trace、audit、operator projection 与 eval backlink
  的共同事实源。
- `RunStep -> StepAttempt -> StepResult` 是 Operator Console、eval、badcase 与
  operational diagnostic artifact 的共同诊断主线；`workflow_trace_summary` 只能作为 bounded summary，不替代
  step-level projection truth。
- production admission truth 不得只存在于某个 `execution-control` /
  `execution-control` 进程内存。
- process-local limiter 只能作为单进程 runtime protection，不能作为全局 production
  scheduler。
- Temporal 是 canonical execution plane；PG 是 product truth / sanitized projection
  truth。
- Redis 只能做非权威 wakeup / live fanout / cache，不得作为 workflow / activity task queue、
  product run projection、event projection 或 terminal state truth。
- K8s 只调度 pod / resource，不拥有 workflow history、task queue、product projection 或
  terminal truth。
- production worker replica autoscaling 的目标 controller 是 KEDA Temporal scaler +
  Kubernetes HPA；repo-owned `worker-autoscaler` 只保留为 Docker Compose local
  diagnostics runtime adapter。
- tool 只有在 normal、fail-close、cancel、timeout、late completion 与 replan
  outcome 都能写入 sanitized step / attempt / result projection，并能被
  app-api operator read model 消费时，才算 production-open。

Current merged execution facts belong in `../current.md`; they
must not be duplicated in this supporting architecture.

## Temporal Execution Plane

Temporal 在目标架构中承接 durable execution substrate。

Temporal owns：

- workflow execution state and history
- workflow task queues and activity task queues
- workflow worker / activity worker dispatch through polling
- retry, timeout, timer and heartbeat mechanics
- signal / query / update delivery
- child workflow orchestration
- schedule and visibility substrate

Repo owns：

- product account/session/conversation truth
- request/run product projection
- tool admission and ToolSpec policy
- source-truth ownership
- final answer contract
- sanitized step / event / result projection
- Operator Console / eval / badcase read model
- observability redaction policy

Temporal history is not the product query source for Operator Console/eval. It
is execution history. Operator Console, eval and badcase consume repo-owned
sanitized projection derived from workflow/activity progress.

## Canonical Objects

### Conversation

`Conversation` 是用户与系统的长期对话边界。

长期 owner 固定为 `apps/app-api`。

它至少承载：

- conversation id
- actor / account projection
- surface origin
- session / caller / surface projection
- committed turn summary
- memory projection refs
- active run policy state

conversation 不存放 raw browser token、Access JWT、cookie、provider raw trace、raw memory
或未经裁剪的 source body。

### Turn

`Turn` 是一次用户输入在 conversation 内的语义边界。

长期上，一个 turn 可以触发一个 primary run；后续 retry、resume 或 repair 必须显式关联原始
turn，而不是静默覆盖 conversation history。

### Run

`Run` 是一次 agent answer execution 的 product-visible durable projection。

Target execution substrate 中，`run_id` 必须与 Temporal workflow id / run id 可稳定关联，但
product run projection 不等于 Temporal internal history。

最小生命周期固定为：

`created -> queued -> admitted -> running -> streaming -> completed / failed /
canceled / expired`

固定规则：

- 创建 run 不表示已经开始执行。
- run admission 与 workflow start / activity scheduling 是不同动作。
- terminal state 必须记录 terminal reason、business outcome、runtime versions 与 safe
  failure summary。
- run state 必须可以被查询、取消、审计和投影。
- run state 不得只存在于 HTTP handler、goroutine、SSE connection 或 worker process 内存。
- `WorkflowRun` 只允许作为 workflow trace / finalizer projection DTO，表达 single-step
  或 multi-step agent/tool graph。它不拥有独立 Postgres store；旧
  `runtime.workflow_runs` store 与 `EXECUTION_CONTROL_WORKFLOW_RUN_*` env 已退役。
  online serving 的持久化只使用 run projection store 与 Temporal workflow history。

### Run Event

`RunEvent` 是 run 的 append-only observation / output record。

长期至少包括：

- run accepted / queued / admitted / started / completed / failed / canceled
- workflow planning decision
- agent invocation started / completed / failed
- tool call / deterministic query call safe summary
- retrieval plan / candidate / selected evidence safe summary
- partial answer delta 或 final answer projection
- token / cost / latency / provider safe summary
- fail-close reason 与 terminal envelope

固定规则：

- streaming 只订阅 run events，不拥有 execution truth。
- panel 与 eval 只能消费 sanitized run event projection 或由它派生的 read model。
- raw prompt、raw answer draft、raw provider response、raw transcript、auth
  material 与 raw source body 不进入 canonical run event。
- 外部 Langfuse/OpenAI debug trace 可以在受控 sink 中保存 raw 或 masked LLM IO；该
  sink 不改变 canonical run event 的 sanitized-only 规则。

### Run Step

`RunStep` 是 run 内一个 typed execution unit。

固定属性：

- step id
- run id
- parent step id / dependency step ids
- execution group
- tool target
- step kind
- target typed tool 或 agent-as-tool
- input projection refs
- output contract
- status、attempt policy、timeout 与 budget

固定规则：

- Execution Agent Layer 只调度 typed step，不调用自由 agent。
- deterministic data access 必须表现为 typed tool step。
- semantic specialist 必须表现为 agent-as-tool step。
- step input 只能引用 sanitized projection；不得携带 raw prompt、raw provider
  trace、raw source body 或未经裁剪附件正文。

### Step Attempt

`StepAttempt` 是 worker 对某个 step 的一次 execution attempt。

固定规则：

- 每次 attempt 必须来自 Temporal activity task。
- retry 必须产生新的 attempt record，不得覆盖旧 attempt。
- attempt status、worker id、task queue、started/completed time、terminal reason
  与 safe failure summary 必须可审计。
- attempt projection 必须记录 scheduled / started / completed timestamps、duration、
  Temporal task queue、worker identity、activity attempt number、provider request ref、
  latency summary、token usage、estimated cost、cancel / timeout outcome 与 retry
  disposition。
- provider / tool / retrieval 调用失败只能写入 bounded failure record，不得由 synthesis 补洞。

### Step Result

`StepResult` 是 typed step 的 sanitized terminal output。

固定规则：

- tool step 产出 typed tool result projection。
- agent-as-tool step 产出 bounded `StepOutputProjection`。
- retrieval step 产出 supporting evidence / query activity projection。
- finalization 只能消费 admitted step result 与 supporting evidence；不得读取 raw tool payload、
  raw provider response 或 raw candidate trace。
- 缺 required step result 时，run 进入 clarification 或 fail-closed terminal path。

### Temporal Workflow

`Temporal Workflow` 是长期 execution lifetime 的 canonical substrate object。

固定规则：

- workflow id 必须可由 repo-owned `run_id` 稳定关联或派生。
- workflow code 只能做确定性编排，不直接执行 provider、Qdrant、object store、Postgres
  external IO。
- external IO 必须进入 Activity。
- workflow 负责 step dependency、retry policy、timeout、signal/cancel、child
  workflow 与
  finalization ordering。
- workflow 不拥有 product auth/session/conversation source truth；它只消费 app-api /
  execution-control 投影后的 bounded context。
- Temporal cancel / timeout 只提供 execution signal、timer、heartbeat 与 activity state
  transition；它不自动停止外部 provider、Qdrant、HTTP 或 SDK 调用。activity implementation
  与 provider adapter 必须监听 cancel context / heartbeat cancellation，并对下游请求执行
  abort 或 close。无法证明 hard-abort 的 provider call 必须在 attempt projection 中标记为
  `abort_unproven` 或等价 terminal outcome，不得把 product canceled state
  误写成 token cost 已停止。

### Activity Attempt

`Activity Attempt` 是 Temporal worker 对 typed tool / agent-as-tool step 的一次执行。

固定规则：

- retry / timeout / heartbeat 由 Temporal Activity policy 承接。
- 每次 attempt 必须投影为 repo-owned sanitized attempt / result record。
- provider / tool / retrieval 调用失败只能写入 bounded failure projection，不得由
  synthesis 补洞。
- activity payload 不得携带 raw browser token、cookie、provider raw trace 或
  unrestricted source body。
- provider-facing activity 必须把 provider request ref、usage extraction、latency、
  token / estimated cost 与 cancel / timeout outcome 写入 sanitized attempt/result
  projection。provider raw response、raw prompt 与 SDK-native trace 不能作为 canonical
  projection。
- Hindsight-facing memory activity 必须把 external API calls 放在 Activity 内执行；
  Workflow 只编排 deterministic state，不直接调用 Hindsight、provider、Qdrant、PG、
  object storage 或 filesystem。

### Target Tool Execution Graph

目标 `ToolExecutionWorkflow` 是当前 Temporal workflow 名称。它不以
RAG 为顶层入口，而是先记录 durable run，
准备 bounded context，再执行 `agent.primary` first decision；该 decision 可以直接
产生 no-tool terminal outcome，也可以选择 admitted tool / workflow signal，再进入
对应 typed tool 或 RAG graph：

```text
context.memory_recall when needed
-> agent.primary first_decision
-> direct/no-tool terminal
-> finalization.write

context.memory_recall when needed
-> agent.primary first_decision
-> admitted tool / workflow signal
-> typed tool or knowledge RAG graph
-> finalization.write
```

固定规则：

- `first_decision` 是 provider/model-facing 的第一 agent decision contract；
  它使用 repo-global invariants / role instructions / typed task packet，并基于
  admitted tool set 判断是否需要工具。它不是 app-api 本地 prompt，
  也不是 surface persona selector。
- direct/no-tool terminal branch 覆盖产品身份说明、普通寒暄、澄清、拒绝、
  out-of-scope 与 fail-close outcome；不得把这些拆成
  `assistant_intro`、`product_meta` 或 synthetic tool。
- `context.memory_recall` 使用 Hindsight runtime recall bounded personal memory
  context，输出 selected count、char budget 与 compact memory items；目标态下它应由
  first decision / workflow plan 明确需要时执行，而不是为了默认进入 RAG 而无条件前置。
- `memory.reflect` 是目标 internal memory tool/function，用于 Hindsight
  memory-grounded reasoning / `based_on` facts；它不替代 `agent.primary` 的 final
  answer owner。
- `memory.operation_status` 是目标 async retain follow-up tool/function，用于确认
  Hindsight 后台处理结果；`memory.append` accepted 不等于 graph materialized。
- `plan.route` 只能作为 retained deterministic support path，不读取 PG profile
  memory full dump，也不把普通 chat
  缺失 tool hint 的请求默认压成 `knowledge_query` / RAG。
- `knowledge` branch 承接 RAG retrieval、evidence、synthesis 与
  `grounding.verify` evidence-integrity verification；该 step 不适用于
  direct/no-tool terminal、campus-services typed tool 或 notice typed tool。
- `campus_services` branch 当前只承接 transport schedule typed tool；service guide、
  contact、calendar、process 与 generic service status 不属于当前
  model-visible runtime surface。
- `notice` branch 承接 notice discovery、selected notice ref resolution、source card
  与 bounded notice context。
- `navigation` branch 在产品/worker path 未开放前 fail closed；开放后只消费 place /
  route / point typed context，不拥有 timetable 或 service-status truth。
- `finalization.write` 只消费 admitted step results，写 sanitized finalization
  projection 与 user-facing answer event。

### Knowledge/RAG Step Graph

`knowledge_query` durable execution must remain a typed step graph:

1. `memory.recall`
1. `planning`
1. `rag.plan`
1. `retrieval.indexed_lookup`
1. `evidence.selection`
1. `synthesis`
1. `grounding.verify`
1. `finalization.write`

固定规则：

- `memory.recall` 使用 Hindsight runtime recall bounded personal memory context，
  输出 selected count、char budget 与 compact memory items。
- `planning` 承接 execution admission / workflow plan projection，不读取 PG
  profile memory full dump。
- `rag.plan` 输出 admitted query mode、scope、budget、required evidence
  contract 与 no-widening policy。
- `retrieval.indexed_lookup` 承接 Go Qdrant indexed retrieval，输出 bounded
  candidate summary 与 query activity projection。
- `evidence.selection` 输出 answer-bearing supporting evidence，不得把 raw candidate
  trace 当作 supporting evidence。
- `synthesis` 只能消费 supporting evidence projection，必须记录 provider request ref、
  latency、token、estimated cost 与 cancel / timeout outcome。
- `grounding.verify` 当前在线语义是 evidence-integrity verification：检查
  synthesis/evidence ref 一致性、`answer_text` presence 与 selected evidence
  `source_ref` presence；不通过时 fail closed。claim / list item semantic
  grounding 属于后续 badcase/eval-driven Go RAG hardening，不得由非 serving
  validator 冒充当前 truth。
- `finalization.write` 只写 sanitized finalization projection 与 user-facing
  answer event。

每个 RAG step 都必须有 `RunStep -> StepAttempt -> StepResult` 轨迹；panel、eval 与
badcase 诊断以这条 step trajectory 为主线，不读取 Temporal history 或 provider raw trace。

### Personal Memory Activity Graph

Personal memory durable execution must keep external memory I/O inside Temporal
Activities:

1. `memory.recall`
1. `memory.reflect`
1. `memory.append`
1. `memory.operation_status`

固定规则：

- `memory.recall` returns only bounded selected memory context for downstream
  agent / RAG / tool steps.
- `memory.reflect` returns sanitized reflection output and optional sanitized
  `based_on` refs; raw Hindsight trace and tool-call logs are debug-only.
- `memory.append` is post-finalization side effect. Failure is projected as
  memory failure and metrics, but does not reverse a completed final answer.
- `memory.operation_status` is the only durable evidence that an async retain
  operation moved beyond accepted request handling, unless a later recall /
  reflect result proves materialization.

### Task Queue

Temporal Task Queue 是 worker dispatch substrate。

第一组 target task queues：

- `campus-agent.workflow`
- `activity.context`
- `activity.knowledge`
- `activity.campus_services`
- `activity.notice`
- `activity.navigation`
- `activity.finalization`
- `activity.projection`

固定规则：

- task queue 按 tool target / resource / latency profile 切分，不按 UI surface 切分。
- worker poll task queue 执行 workflow task 或 activity task。
- task queue backlog 是 autoscaling input，不是 product read model。
- task queue 不替代 app-api conversation truth、operator projection 或 eval
  denominator。

### Execution Group

`Execution group` 是 production scheduling 的预算维度。它是内部调度和
projection 维度，不是产品级 routing 概念，也不是对外 tool taxonomy。

目标 canonical execution groups 包括：

- `knowledge`
- `notice`
- `navigation`
- `campus_services`
- `default`

长期规则：

- execution group 预算由 workflow admission policy、Temporal task queue budget projection、
  downstream budget projection 与 worker autoscaler 共同定义；不得重新引入 PG lease
  coordinator 作为 online execution truth。
- execution group 对应的 task queue 与 worker pool 可以独立扩容。
- knowledge、notice、navigation 与 campus services 不得互相占死 execution capacity。
- provider、Qdrant、Postgres、object store 等 downstream budget 必须作为 scheduler 输入。
- 新增 execution group 必须同步 contract、observability、eval denominator 与 runbook。

## Runtime Components

### `apps/app-api`

`apps/app-api` 长期负责：

- browser / Worker surface intake
- auth、session、principal 与 conversation truth
- surface tool policy
- request normalization
- run creation command
- run status / event stream proxy
- cancel / retry / resume command admission
- operator-safe run projection

`apps/app-api` 不负责：

- agent semantic reasoning
- retrieval execution
- worker lease ownership
- provider call execution

### `execution-control`

`execution-control` 是 trusted internal execution ingress。

当前实现名仍是 `apps/execution-control`；长期概念名是 `execution-control`。

它负责：

- trusted machine ingress from app-api
- tool admission closeout
- workflow template selection
- Temporal workflow start / signal / cancel / query / update
- workflow planning
- global / execution-group / actor / conversation / provider budget projection
- cancel / timeout / drain semantics
- finalization
- runtime metrics、audit 与 trace projection

它不负责：

- product-layer auth/session/conversation ownership
- browser-facing tool policy
- typed tool / explicit agent-as-tool semantic reasoning
- retrieval backend implementation
- worker autoscaling decision

进程内 lifecycle / admission / queue 只能作为本进程 runtime protection。canonical execution
truth 属于 Temporal workflow / task queue；product truth 属于 repo-owned projection。

### Temporal Runtime Roles

长期 runtime roles 固定为：

- `execution-control`
  - internal command-query surface、workflow start / signal / cancel / query / update、
    readyz / metrics 与 projection command。
- `workflow-worker`
  - polls workflow task queues and executes deterministic workflow code.
- `activity-worker-{tool-target}`
  - polls tool-target task queues
  - executes typed tool / agent-as-tool activities
  - writes sanitized projection
- `projection-worker`
  - materializes workflow/activity progress into app-api / Operator Console /
    eval read models
  - used when direct activity writeback is not the selected implementation
- `worker-autoscaler`
  - local diagnostics role that reads Temporal task queue metrics, worker poller
    health, downstream budget projection and SLO policy; adjusts local worker
    replica count only.
  - production target role is KEDA Temporal scaler + Kubernetes HPA.

### Worker Pools

worker pool 按 execution group / tool target 组织。

固定规则：

- 每个 worker 只能执行 Temporal task queue 分派的 workflow / activity task。
- tool worker pool 可以横向扩容；扩容只增加消费能力，不改变 workflow history、
  task queue truth 或 product projection truth。
- worker pool 不写 global budget、不决定未授权 terminal state、不绕过 workflow policy。
- execution-group worker pool 的性能优化必须围绕 step specialization、connection reuse、provider
  concurrency、retrieval/tool batching、bounded prompt assembly 与 backpressure；不得通过扩大
  prompt context、跳过 evidence verifier 或绕过 policy gate 换取吞吐。
- K8s 可以承载这些 worker pod，但 K8s readiness / HPA metric 不是 execution truth。

## Admission Stack

长期 admission 固定分为四层。

### Surface Admission

Owner：`apps/app-api`。

判断：

- 当前 browser surface 是否允许该 tool
- actor / session / operator context 是否满足产品入口条件
- request 是否符合 surface contract

### Account / Quota Admission

Owner：`apps/app-api` 与 scheduler 共享，但 canonical account / session truth 在
`apps/app-api`。

判断：

- account / session 的预算
- abuse control
- per-conversation active run policy

### Run Admission

Owner：`execution-control` + Temporal workflow admission policy。

判断：

- 是否允许创建或推进一个 workflow-backed run
- workflow mode 是否打开
- selected tool / execution group 是否可用
- required context projection 是否满足

### Activity Dispatch Admission

Owner：Temporal workflow policy + task queue worker matching。

判断：

- 当前 tool target / task queue 是否还有执行预算
- downstream provider / retrieval / database 是否还有预算
- worker 是否符合该 activity 的 tool target / version / readiness 条件
- activity retry、timeout、heartbeat policy 是否满足

当前 runtime config 中的 admission budget 只表达 current process-local
execution protection。它不得被解释为完整 production admission model。

## Conversation Concurrency Policy

长期默认策略：

- 一个 conversation 同时最多一个 active primary run。
- 第二条用户消息进入时，如果前一个 primary run 仍 active，默认返回
  `conversation_active_run`。
- `enqueue`、`cancel_then_start`、`interrupt`、`rollback` 只能作为显式产品语义开启。
- conversation context 只从 completed / committed run 进入下一轮。
- canceled / failed run 是否进入 context，必须由 typed terminal policy 决定。

禁止行为：

- 用 raw transcript 追加顺序掩盖并发冲突。
- 在 worker 内部暗中取消或合并另一个 active run。
- 让多个 active run 同时写同一个 conversation committed context。

## Streaming / Resume / Cancel

长期 streaming 固定为：

`browser -> app-api stream endpoint -> run event subscription`

固定规则：

- SSE / WebSocket 连接断开不等于 run 自动失败。
- 是否断线取消由 run policy 决定，不能由 transport accident 隐式决定。
- client 可以用 `run_id` 查询 terminal status。
- cancel 必须是显式 command，并经过 app-api / Execution Agent Layer admission。
- resume 只能恢复 event stream 或读取已投影状态；不能重新执行同一个 run，除非创建明确 retry /
  repair run。

## Queue, Scheduling And Recovery

Temporal-backed execution plane 必须支持：

- global active workflow / activity budget projection
- per-tool-target task queue budget projection
- per-user / per-org active run and queued run budget
- per-conversation active run policy
- downstream resource budget
- activity heartbeat / timeout
- worker crash detection
- run timeout and step timeout
- drain and deployment handoff
- terminal state projection

canonical execution queue 形态固定为 Temporal Task Queue：

- workflow task queue
- activity task queue
- worker polling
- Temporal retry / timeout / heartbeat / timer semantics

PG rows must not be used as a queue substrate.

Redis 不进入 canonical queue path。允许的 Redis 用途只包括：

- 非权威 wakeup signal
- browser live fanout 加速
- cache / invalidation
- derived dashboard counter

Redis 丢失、flush、延迟或重启不得导致 run、step、lease、event 或 terminal state 丢失，也不得让
worker 绕过 Temporal workflow / task queue policy。

失败处理固定为 fail closed：

- run store unavailable：不能创建新的 run
- Temporal service unavailable：不能 start / signal / query workflow
- task queue unavailable：不能 dispatch activity
- worker readiness mismatch：不能领取对应 tool-target activity task
- required projection missing：run 进入 terminal failed / clarification path
- workflow/activity metadata drift：不得执行该 step

## Deployment Substrate And Autoscaling Boundary

canonical execution truth 固定在 Temporal execution plane 中；PG 承接 product truth 与
sanitized projection truth。

repo-owned target durable substrate 固定为：

`Temporal workflow / activity / task queue + Postgres product projection`

原因：

- Temporal 直接提供 workflow history、activity retry、timeout、heartbeat、signal、query、
  update、task queue 与 worker polling。
- repo 可以把精力放在 tool contract、projection、eval、panel 与 source-truth 边界，
  不继续自研通用 scheduler / lease / recovery kernel。
- PG 继续保留 product/runtime projection schema boundary，避免 Temporal history 直接泄漏给
  product UI、panel 或 eval。

K8s 边界固定为：

- K8s 调度 pod、resource request/limit、service discovery、rollout、liveness/readiness。
- K8s 不拥有 workflow history、task queue truth、product run projection、event
  projection 或 terminal state。
- K8s Job / CronJob / HPA / KEDA 只能基于 Temporal metrics 与 repo-owned
  budget projection 调整 worker presence；不能成为 canonical execution scheduler。
- production target 使用 KEDA Temporal scaler 读取 Temporal task queue backlog，并由
  Kubernetes HPA 对 workflow / activity worker Deployment 调整 replica count。

worker autoscaler 边界固定为：

- 输入：Temporal task queue backlog、oldest schedule-to-start latency、poller health、
  workflow/activity latency、downstream budget projection、SLO target。
- 输出：workflow / activity worker desired replica count。
- 禁止：写 workflow state、product run projection、step projection、event projection、直接标记
  terminal state、基于 raw prompt 或 raw provider trace 做扩缩容。
- production 目标态中，desired replica 由 KEDA/HPA 计算和执行；repo-owned
  autoscaler 不再承担生产控制器职责。
- 当前 self-hosted sampler 使用 Temporal `DescribeTaskQueue(report_stats=true)`，
  可靠采样 poller identity / poller count、approximate backlog count 与
  approximate backlog age；schedule-to-start latency 仍必须显式标记为
  `unsupported_by_source`，直到接入专门 latency metrics source。
- 负载扩缩容只可由连续 observed backlog / oldest-task-age 窗口驱动；unsupported
  load metrics 不能被解释为 0 或健康状态，只能形成 hold 证据。poller 缺失可独立驱动
  worker presence repair。
- cooldown 由 app-api operator runtime actuation projection 驱动；worker-autoscaler
  通过 internal query seam 读取最近 actuation，而不是直连 app-api database。
- autoscaler 的 operator-facing 证据归属 app-api runtime projection，contract 见
  `docs/contracts/operator-runtime.md`。
- K8s/KEDA target deployment substrate 的完整设计见
  `k8s-runtime.md`。

## Current-State Ownership

This document owns durable runtime semantics, not merged implementation status,
  active work signals or release closeout evidence. Current-state facts must stay in
these owner classes:

- merged topology and implemented execution path:
  `../current.md`
- durable execution work signals and backlog pointers:
  `../../../.planning/PROJECT.md` and `../../../.planning/WORKSTREAMS.md`
- operational validation, staging closeout and recovery commands:
  `../../runbooks/`

Do not add implementation-progress lists to this supporting architecture. If a
new runtime fact needs to persist, promote it to `current.md`, the
matching contract/schema, an ADR or a runbook.

Durable runtime work must not be marked complete by simple multi-instance HTTP
load balancing, Redis queue usage or K8s HPA alone. The canonical validation
source remains Temporal workflow history plus repo-owned sanitized run / event /
step / attempt / result projection.

Stable artifacts for this architecture:

- `docs/decisions/adr-0048-temporal.md`
- `docs/contracts/durable-runtime.md`
- `docs/data/durable-runtime.md`

## Related Documents

- `docs/architecture/current.md`
- `docs/architecture/target.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/execution-agent-layer.md`
- `docs/architecture/system/agent-framework.md`
- `docs/architecture/system/tool-runtime.md`
- `docs/architecture/system/tool-routing.md`
- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/k8s-runtime.md`
- `docs/contracts/durable-runtime.md`
- `docs/data/durable-runtime.md`
- `docs/decisions/adr-0048-temporal.md`
- `docs/decisions/adr-0056-k8s-keda.md`
