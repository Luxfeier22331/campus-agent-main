---
doc_type: architecture
status: active
created: 2026-06-04
updated: 2026-06-12
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
- 当前 staging 的一次部署证据是否已经覆盖所有 production topology
- 某个 worker pool 的机器规格或具体 autoscaling 阈值
- eval、retrieval、ingestion 的 collection-specific release 细节

当前 merged truth 仍以 `docs/architecture/current-architecture.md` 为准。本文描述的是
supporting architecture；实现状态必须单独写在 current architecture 或 evidence artifact 中。

## Core Conclusion

`campus-agent` 的 production execution model 固定为：

`surface request -> app-api surface / account projection -> durable conversation
and run projection -> execution-control -> Temporal workflow -> task queues ->
workflow / activity worker pools -> typed step results -> sanitized run event +
step / attempt / result projection -> app-api stream / projection / operator read
model -> browser surface / panel / eval / badcase`

核心规则：

- HTTP request 不等于 agent execution lifetime。
- `run_id` 是一次回答的 canonical execution object。
- `conversation_id` 是上下文、account / session、memory binding 与同会话并发策略的边界。
- `run_events` 是 streaming、trace、audit、operator projection 与 eval backlink
  的共同事实源。
- `RunStep -> StepAttempt -> StepResult` 是 panel、eval、badcase 与 release
  evidence 的共同诊断主线；`workflow_trace_summary` 只能作为兼容摘要，不替代
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
- capability 只有在 normal、fail-close、cancel、timeout、late completion 与 replan
  outcome 都能写入 sanitized step / attempt / result projection，并能被
  app-api operator read model 消费时，才算 production-open。

Current implementation baseline:

- online chat path already enters the Temporal-backed
  `CapabilityExecutionWorkflow`.
- chat trajectory projection now uses the Temporal-visible primary agent graph:
  `context.memory_recall -> agent.primary -> finalization.write`. `agent.primary`
  calls `apps/agent-runtime`, which uses OpenAI Agents SDK for the model-facing
  tool loop and direct/no-tool final output. Go `execution-control` keeps
  durable workflow ownership, visible capability filtering, timeout/cancel,
  sanitized step projection and finalization. The retained deterministic branch
  support path still contains `plan.route -> capability branch`; the `knowledge`
  branch runs `rag.plan -> retrieval.indexed_lookup ->
  retrieval.expand_or_rescue -> evidence.selection -> synthesis ->
  grounding.verify`.
- first-class step attempt evidence fields exist in the projection store,
  execution-control `/steps` API, app-api operator summary and panel trajectory:
  Temporal workflow/activity metadata, queue wait, duration, provider/model,
  token/cost and cancel/timeout outcome.
- `provider_execution_summary_v1` and provider pricing readiness are
  repo-owned contracts. Activity context cancellation, timeout outcomes and Go
  provider connection abort are projected as first-class attempt outcomes.
- online RAG lookup and synthesis are owned by Go `activity-worker-knowledge`:
  retrieval uses the Qdrant native adapter against the authenticated private
  data-plane, synthesis executes the provider call, records usage / estimated
  cost / cancel outcome and stores sanitized finalization input.
- online primary agent execution is owned by `activity-worker-agent` +
  `apps/agent-runtime`: SDK selected tools, tool result refs, usage summary and
  SDK trace refs are normalized into repo-owned sanitized projection before
  app-api / panel / eval consumption. Model-selected read-only
  campus-services / notice tool calls are projected as
  `sdk_tool.execute.<tool>.<index>` tool steps with `typed_tool_result` or
  `activity_failure` step results; `knowledge_query` remains a workflow signal
  into the Go-owned RAG graph instead of a bounded JSON typed tool result.
- Python `apps/supervisor-agent-worker` has been removed from the active
  workspace. Historical bridge code is recoverable only through git history and
  must not be restored as a serving fallback or readiness dependency.

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
- capability admission, ToolSpec and CapabilitySpec policy
- source-truth ownership
- final answer contract
- sanitized step / event / result projection
- panel / eval / badcase read model
- observability redaction policy

Temporal history is not the product query source for panel/eval. It is execution
history. Panel, eval and badcase consume repo-owned sanitized projection derived
from workflow/activity progress.

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

### Run Step

`RunStep` 是 run 内一个 typed execution unit。

固定属性：

- step id
- run id
- parent step id / dependency step ids
- lane
- capability family
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

- 每次 attempt 必须来自 Temporal activity task；PG execution lease attempt 只属于
  historical baseline，不再授权 online serving。
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

### Target Capability Execution Graph

目标 `CapabilityExecutionWorkflow` 不以 RAG 为顶层入口。它先记录 durable run，
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
  admitted tool/capability set 判断是否需要工具。它不是 app-api 本地 prompt，
  也不是 surface persona selector。
- direct/no-tool terminal branch 覆盖产品身份说明、普通寒暄、澄清、拒绝、
  out-of-scope 与 fail-close outcome；不得把这些拆成
  `assistant_intro`、`product_meta` 或 synthetic capability。
- `context.memory_recall` 使用 Qdrant `personal_memory_v1` recall bounded personal
  memory context，输出 selected count、char budget 与 compact memory items；目标态下它应由
  first decision / workflow plan 明确需要时执行，而不是为了默认进入 RAG 而无条件前置。
- `plan.route` 只能作为 retained deterministic support path / historical
  planning artifact，不读取 PG profile memory full dump，也不把普通 chat
  缺失 capability 的请求默认压成 knowledge/RAG。
- `knowledge` branch 承接 RAG retrieval、evidence、synthesis 与 grounding。
- `campus_services` branch 承接 service guide/status/schedule/contact/calendar typed
  tools 或明确 semantic specialist step。
- `notice` branch 承接 notice discovery、selected notice ref resolution、source card
  与 bounded notice context。
- `navigation` branch 在产品/worker path 未开放前 fail closed；开放后只消费 place /
  route / point typed context，不拥有 timetable 或 service-status truth。
- `finalization.write` 只消费 admitted step results，写 sanitized finalization
  projection 与 user-facing answer event。

### Current Knowledge/RAG Implementation Graph

当前 online RAG durable graph 已硬切为：

1. `memory.recall`
1. `planning`
1. `rag.plan`
1. `retrieval.indexed_lookup`
1. `retrieval.expand_or_rescue`
1. `evidence.selection`
1. `synthesis`
1. `grounding.verify`
1. `finalization.write`

固定规则：

- `memory.recall` 使用 Qdrant `personal_memory_v1` recall bounded personal memory
  context，输出 selected count、char budget 与 compact memory items。
- `planning` 承接 execution admission / workflow plan projection，不读取 PG
  profile memory full dump。
- `rag.plan` 输出 admitted query mode、scope、budget、required evidence
  contract 与 no-widening policy。
- `retrieval.indexed_lookup` 承接 Qdrant / retrieval-core indexed retrieval，输出 bounded
  candidate summary 与 query activity projection。
- `retrieval.expand_or_rescue` 只允许在 plan admission 的范围内执行 parent context expansion、
  historical / freshness branch 或 rescue step；不得扩大 query-enabled surface。
- `evidence.selection` 输出 answer-bearing supporting evidence，不得把 raw candidate
  trace 当作 supporting evidence。
- `synthesis` 只能消费 supporting evidence projection，必须记录 provider request ref、
  latency、token、estimated cost 与 cancel / timeout outcome。
- `grounding.verify` 必须检查 claim / list item support、source span、coverage
  与 unsupported branch，不通过时进入 clarification 或 fail-closed terminal path。
- `finalization.write` 只写 sanitized finalization projection 与 user-facing
  answer event。

每个 RAG step 都必须有 `RunStep -> StepAttempt -> StepResult` 轨迹；panel、eval 与
badcase 诊断以这条 step trajectory 为主线，不读取 Temporal history 或 provider raw trace。

### Task Queue

Temporal Task Queue 是 worker dispatch substrate。

第一组 target task queue family：

- `campus-agent.workflow`
- `activity.context`
- `activity.knowledge`
- `activity.campus_services`
- `activity.notice`
- `activity.navigation`
- `activity.finalization`
- `activity.projection`

固定规则：

- task queue 按 capability / resource / latency profile 切分，不按 UI surface 切分。
- worker poll task queue 执行 workflow task 或 activity task。
- task queue backlog 是 autoscaling input，不是 product read model。
- task queue 不替代 app-api conversation truth、operator projection 或 eval
  denominator。

### Lane

`Lane` 是 production scheduling 的能力预算维度。

目标 canonical lane family 包括：

- `knowledge`
- `notice`
- `navigation`
- `campus_services`
- `default`

长期规则：

- lane 预算由 workflow admission policy、Temporal task queue budget projection、
  downstream budget projection 与 worker autoscaler 共同定义；不得重新引入 PG lease
  coordinator 作为 online execution truth。
- lane queue 与 worker pool 可以独立扩容。
- knowledge、notice、navigation 与 campus services 不得互相占死 execution capacity。
- provider、Qdrant、Postgres、object store 等 downstream budget 必须作为 scheduler 输入。
- 新增 lane 必须同步 contract、observability、eval denominator 与 runbook。

## Runtime Components

### `apps/app-api`

`apps/app-api` 长期负责：

- browser / Worker surface intake
- auth、session、principal 与 conversation truth
- surface capability policy
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
- capability admission closeout
- workflow template selection
- Temporal workflow start / signal / cancel / query / update
- workflow planning
- global / lane / actor / conversation / provider budget projection
- cancel / timeout / drain semantics
- finalization
- runtime metrics、audit 与 trace projection

它不负责：

- product-layer auth/session/conversation ownership
- browser-facing capability policy
- capability / explicit agent-as-tool semantic reasoning
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
- `activity-worker-{capability}`
  - polls capability task queues
  - executes typed tool / agent-as-tool activities
  - writes sanitized projection
- `projection-worker`
  - materializes workflow/activity progress into app-api / panel / eval read models
  - used when direct activity writeback is not the selected implementation
- `worker-autoscaler`
  - reads Temporal task queue metrics, worker poller health, downstream budget projection
    and SLO policy; adjusts worker replica count only.

### Retired Python Semantic Bridge

`apps/supervisor-agent-worker` 已从 active workspace 删除。旧 Python semantic
bridge code 只可通过 git history 追溯；不得作为 serving fallback、staging readiness
dependency 或 Temporal workflow branch 恢复。

它不负责：

- run creation truth
- global admission truth
- product identity truth
- final public response envelope
- RAG DTO canonical boundary
- provider hot path, token/cost accounting, cancel outcome truth

### Worker Pools

worker pool 按 lane / capability family 组织。

固定规则：

- 每个 worker 只能执行 Temporal task queue 分派的 workflow / activity task。
- capability worker pool 可以横向扩容；扩容只增加消费能力，不改变 workflow history、
  task queue truth 或 product projection truth。
- worker pool 不写 global budget、不决定未授权 terminal state、不绕过 workflow policy。
- lane worker pool 的性能优化必须围绕 step specialization、connection reuse、provider
  concurrency、retrieval/tool batching、bounded prompt assembly 与 backpressure；不得通过扩大
  prompt context、跳过 evidence verifier 或绕过 policy gate 换取吞吐。
- K8s 可以承载这些 worker pod，但 K8s readiness / HPA metric 不是 execution truth。

## Admission Stack

长期 admission 固定分为四层。

### Surface Admission

Owner：`apps/app-api`。

判断：

- 当前 browser surface 是否允许该 capability
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
- selected capability / lane 是否可用
- required context projection 是否满足

### Activity Dispatch Admission

Owner：Temporal workflow policy + task queue worker matching。

判断：

- 当前 capability / task queue 是否还有执行预算
- downstream provider / retrieval / database 是否还有预算
- worker 是否符合该 activity 的 capability / version / readiness 条件
- activity retry、timeout、heartbeat policy 是否满足

当前 `EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS`、
`EXECUTION_CONTROL_QUEUE_CAPACITY` 与 `EXECUTION_CONTROL_QUEUE_TIMEOUT_MS` 只表达
current process-local execution protection。
它们不得被解释为完整 production admission model。

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
- per-capability task queue budget projection
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

PG queued rows / `FOR UPDATE SKIP LOCKED` 是当前 baseline 和 migration evidence，不是
target execution substrate。

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
- worker readiness mismatch：不能领取对应 lane lease
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
- repo 可以把精力放在 capability contract、projection、eval、panel 与 source-truth 边界，
  不继续自研通用 scheduler / lease / recovery kernel。
- PG 继续保留 product/runtime projection schema boundary，避免 Temporal history 直接泄漏给
  product UI、panel 或 eval。

K8s 边界固定为：

- K8s 调度 pod、resource request/limit、service discovery、rollout、liveness/readiness。
- K8s 不拥有 workflow history、task queue truth、product run projection、event
  projection 或 terminal state。
- K8s Job / CronJob / HPA / KEDA 只能基于 Temporal metrics 与 repo-owned
  budget projection 调整 worker presence；不能成为 canonical execution scheduler。

worker autoscaler 边界固定为：

- 输入：Temporal task queue backlog、oldest schedule-to-start latency、poller health、
  workflow/activity latency、downstream budget projection、SLO target。
- 输出：workflow / activity worker desired replica count。
- 禁止：写 workflow state、product run projection、step projection、event projection、直接标记
  terminal state、基于 raw prompt 或 raw provider trace 做扩缩容。

## Current Implementation State

当前实现已经具备：

- Go `execution-control` execution ingress
- in-process lifecycle registry
- global / per-lane admission
- bounded in-memory queue
- timeout / cancel / drain
- retired bridge circuit breaker code still exists only behind historical /
  retired bridge paths; it is not an online serving dependency
- metrics / OTel / execution audit seam
- `WorkflowRunStore` foundation for gated multi-step path
- isolated historical run projection store kernel in `apps/execution-control/internal/execution`
  for `DurableRun`、`RunEvent`、`ExecutionLease`、`LaneBudget` 与
  `WorkerHeartbeat`
- Postgres-backed run projection store with explicit
  `EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL` configuration
- retained PG lease coordinator / worker loop / recovery loop code exists as a
  migration artifact, but the online serving path is Temporal-backed. Staging and
  production env must reject `EXECUTION_CONTROL_DURABLE_WORKER_LOOP_*` and
  `EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_*` rather than re-enable PG lease
  execution.
- Temporal owns queued workflow/activity execution, retry, timeout, and worker
  poller semantics. PG runtime tables are the sanitized product projection store,
  not the scheduler truth.
- cancel command is Temporal-owned first: execution-control cancels the current
  answer workflow implementation and then writes sanitized cancel projection;
  lease release semantics are not part of the online cancel path.
- app-api execution runtime adapter and product request cutover foundation:
  accepted chat requests create execution-control runs, persist `run_id`
  backlinks in `runtime.request_execution`, and execution-configured blocking /
  stream chat paths poll browser-visible run events by `after_sequence` cursor
  and finalize from `finalization.completed` run event payloads; stream submit
  registers an app-api-owned `waitUntil` finalization closeout before emitting
  `request.accepted`, so browser disconnect no longer owns finalization
- app-api product run command-query endpoints:
  `/api/chat/runs/:runId`, `/api/chat/runs/:runId/events`,
  `/api/chat/runs/:runId/events/stream`, and
  `/api/chat/runs/:runId/cancel` verify local request ownership before proxying
  execution-control run status, browser-visible events, browser resume stream,
  and cancel commands
- split execution worker binaries exist:
  `cmd/workflow-worker`, `cmd/activity-worker-context`,
  `cmd/activity-worker-agent`, `cmd/activity-worker-knowledge`,
  `cmd/activity-worker-campus-services`, `cmd/activity-worker-notice`,
  `cmd/activity-worker-navigation`, and `cmd/activity-worker-finalization`;
  Docker Compose runs them as separate services with explicit
  `<env>:<role>:<instance>` worker identity.
- step projection writeback exists for the current capability execution
  trajectory: `agent.primary`、branch steps and `finalization.write` write
  sanitized step / attempt / result projection rows; retained deterministic
  support paths can still project `plan.route` where explicitly used.
  Attempt rows include Temporal activity metadata, queue wait, duration,
  provider/model, token/cost, cancel/timeout/late-completion outcome,
  fail-close reason and replan reason fields. Online RAG lookup and synthesis
  run inside Go `activity-worker-knowledge`, so lookup latency, provider usage /
  cost and `provider_connection_aborted` evidence can be filled from activity
  execution. User cancel projection now marks incomplete step/attempt rows with
  `requested_before_start` or `activity_context_canceled` while preserving
  completed step evidence.
- repo-owned staging durable reconnect harness:
  `pnpm --dir apps/app-api chat:durable:e2e:staging` proves the product stream can
  be disconnected after `request.accepted` and resumed from the existing durable
  run event stream by `run_id + after_sequence`
- retired repo-owned Postgres run projection proof command:
  `apps/execution-control/cmd/durable-runtime-proof` is only available with the
  `retired_pg_lease` build tag for migration audits. It is not part of the
  default build, staging closeout, or online serving proof.
- repo-owned deployed execution-control Temporal HTTP proof command:
  `apps/execution-control/cmd/temporal-runtime-http-proof` records deployed
  execution-control `/readyz` evidence and fails closed unless projection store,
  and Temporal runtime are reported ready
- repo-owned worker autoscaler dry-run proof command:
  `apps/execution-control/cmd/worker-autoscaler` reads task queue / downstream
  budget observations and writes desired-replica evidence without writing
  workflow state, run projection, step projection, event projection, or terminal
  state
- public-chat pending-run product baseline: accepted durable run identity is
  persisted in tab-scoped storage, browser resume reads the existing run event
  stream by `run_id + after_sequence`, terminal events load canonical
  conversation truth before clearing pending state, and draft `/chat` routes are
  replaced with the canonical conversation route after recovery
- product run phase projection: app-api maps execution durable run status into
  a typed product phase, `request.accepted` emits the created durable run phase,
  public-chat persists that phase in pending-run state, and protected panel
  request detail displays the same phase instead of deriving queue state locally

当前缺口：

- Temporal poller proof 已进入 execution-control readyz：readyz 会检查
  workflow、RAG activity、finalization activity 与已打开 capability 对应 activity
  task queue 的 recent poller。schedule-to-start latency 仍需要来自 Temporal metrics
  的真实采样进入 release evidence。
- failure-mode staging proof 仍需闭环：repo-local projection 已能用同一
  `operator_step_trajectory.v1` 口径解释 cancel、timeout、late completion ignored、
  semantic fail-close 与 bounded replan；真实 staging run、Temporal metrics sampling
  与 release evidence 仍后置。
- execution-control 概念已完成代码/部署命名收口到 `apps/execution-control`，历史
  PG lease proof command 已退出默认 build；`run_projection*.go` 仍有 projection store 与
  historical schema artifact 混合命名，需要后续纯命名整理，但不得重新接回 serving。
- step-level projection 已进入 current chat trajectory；app-api operator query 与
  protected panel 消费 `agent_run_steps`、`agent_step_attempts`、
  `agent_step_results` 作为诊断主线。app-api request observability detail 已从
  execution-control sanitized step projection materialize
  `operator_step_trajectory.v1`；panel formatter diagnostic groups、eval/badcase
  stage attribution 与 release-evidence-shaped local fixture 已统一消费该 export。
  当前阶段不做真实 staging evidence closeout。
- worker autoscaler 已有 dry-run proof 与 apply-mode evidence-only 边界：可以基于
  task queue observation、poller health 与 downstream budget projection 计算 desired
  replicas；`apply` 没有显式 actuation evidence path 时 fail closed，提供路径时只写
  ops-plane actuation evidence 与 desired replica operations，仍不写
  workflow/run/step/event truth。真实基础设施扩缩容接入仍未启用。
- RAG durable typed step graph 已进入 current online path：`rag.plan`、
  `retrieval.indexed_lookup`、`retrieval.expand_or_rescue`、`evidence.selection`、
  `synthesis`、`grounding.verify` 与 `finalization.write` 均写 sanitized step
  trajectory。primary-agent path 已具备 bounded semantic retry：失败的 SDK
  typed tool result 只有在 typed outcome 属于
  `provider_timeout`、`tool_handler_failed`、`provider_connection_aborted`、
  `tool_executor_not_configured` 或 `transient_internal_query_failed` 时，才能在同一
  visible capability/tool set 内最多重试一次；确定性 semantic / policy /
  contract / admission failure 和未知原因不触发 replan，并通过 step attempt
  `replan_reason` 投影。
- primary model-facing SDK loop 已进入 current worktree：`agent.primary` 通过 strict
  `tool-catalog.v1` 暴露 model-visible read-only tools，`knowledge_query` 作为 workflow
  signal 进入 Go-owned RAG graph，campus-services / notice tools 通过
  execution-control internal query executor 读取 bounded projection/read model，并把
  success / fail-close tool result 投影成
  `sdk_tool.execute.<tool>.<index>` normalized tool step。ordinary chat 缺失
  `requested_capability` 时已不再默认 `knowledge`，而是保持 capability-neutral
  进入 `agent.primary`。`clarification_required`、`out_of_scope` 与
  `unsupported_by_evidence` 已分别投影为 `needs_clarification`、`rejected` 与
  `no_answer` finalization outcome。canonical `tool_function_schemas.v1` 已覆盖
  model-visible strict function schema，agent-runtime 返回 `arguments_json`，并由
  execution-control 在 SDK typed tool projection 前验证；schema drift 作为
  `schema_contract_drift` fail-close step 投影。剩余缺口不再是“是否接入
  provider-native tool loop”或“是否硬化 strict argument schema”，而是真实
  runtime/staging proof。
- panel / eval / observability 已统一到 step-level trajectory 的第一版 consumer
  contract：routing、primary agent、typed tool、retrieval、rerank、selection、
  synthesis、grounding、finalization、replan 与 terminal outcome
  (`clarification` / `rejected` / `no_answer`) 都可作为诊断阶段进入
  eval/badcase attribution，panel formatter 以 grouped diagnostics 展示 runtime /
  terminal / replan / agent outcome。release evidence 当前只能生成
  release-evidence-shaped local fixture，不接真实 Temporal metrics 或 staging
  closeout。

这些 gap 不得通过简单多开实例、HTTP load balancing、Redis queue 或 K8s HPA 标记为已解决。

当前落盘产物：

- `docs/decisions/adr-0048-temporal-execution-plane.md`
  - 当前实现差距矩阵
- `docs/contracts/durable-agent-runtime-contract.md`
  - conversation / run / event / lease / lane 的概念 contract
- `docs/data/durable-agent-runtime-schema.md`
  - run projection logical schema
- `apps/execution-control/internal/execution/run_projection*.go`
  - isolated durable store kernel、lease coordinator、in-memory contract substrate
    与 Postgres store foundation
- `apps/execution-control/cmd/durable-runtime-proof`
  - retired Postgres-backed PG lease proof command, compiled only with
    `retired_pg_lease`

## Related Documents

- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/durable-agent-runtime-contract.md`
- `docs/data/durable-agent-runtime-schema.md`
- `docs/decisions/adr-0048-temporal-execution-plane.md`
