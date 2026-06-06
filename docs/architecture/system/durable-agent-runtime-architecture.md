---
doc_type: architecture
status: active
created: 2026-06-04
updated: 2026-06-06
---
# Durable Agent Runtime Architecture

## 文档边界

本文冻结 `campus-agent` 长期 production agent runtime 的 durable execution
supporting architecture。

它回答的是：

- 一次用户回答的 canonical execution object 是什么
- conversation、run、event、Temporal workflow、task queue 与 worker pool 的长期关系是什么
- production 并发预算、排队、取消、恢复、step execution 与 streaming 应由哪一层拥有
- `execution-gateway`、Temporal workflow worker、activity worker pool 与 worker autoscaler
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

`surface request -> app-api surface / identity projection -> durable conversation
and run projection -> execution-gateway -> Temporal workflow -> task queues ->
workflow / activity worker pools -> typed step results -> sanitized projection ->
app-api stream / projection -> browser surface`

核心规则：

- HTTP request 不等于 agent execution lifetime。
- `run_id` 是一次回答的 canonical execution object。
- `conversation_id` 是上下文、权限、memory 与同会话并发策略的边界。
- `run_events` 是 streaming、trace、audit、operator projection 与 eval backlink
  的共同事实源。
- production admission truth 不得只存在于某个 `execution-gateway` /
  `execution-gateway` 进程内存。
- process-local limiter 只能作为单进程 runtime protection，不能作为全局 production
  scheduler。
- Temporal 是 canonical execution plane；PG 是 product truth / sanitized projection
  truth。
- Redis 只能做非权威 wakeup / live fanout / cache，不得作为 workflow / activity task queue、
  product run projection、event projection 或 terminal state truth。
- K8s 只调度 pod / resource，不拥有 workflow history、task queue、product projection 或
  terminal truth。

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

- product auth/session/conversation truth
- request/run product projection
- capability admission, ToolSpec and AgentSpec policy
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
- actor / principal projection
- surface origin
- authorization / visibility projection
- committed turn summary
- memory projection refs
- active run policy state

conversation 不存放 raw browser token、Access JWT、cookie、provider raw trace 或未经裁剪的完整
restricted source body。

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
  material 与 restricted raw body 不进入 canonical run event。

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

- supervisor 只调度 typed step，不调用自由 agent。
- deterministic data access 必须表现为 typed tool step。
- semantic specialist 必须表现为 agent-as-tool step。
- step input 只能引用 sanitized projection；不得携带 raw prompt、raw provider
  trace、raw source body 或未经裁剪附件正文。

### Step Attempt

`StepAttempt` 是 worker 对某个 step 的一次 execution attempt。

固定规则：

- 每次 attempt 必须由 active execution lease 授权。
- retry 必须产生新的 attempt record，不得覆盖旧 attempt。
- attempt status、worker id、lease id、started/completed time、terminal reason
  与 safe failure summary 必须可审计。
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
  execution-gateway 投影后的 bounded context。

### Activity Attempt

`Activity Attempt` 是 Temporal worker 对 typed tool / agent-as-tool step 的一次执行。

固定规则：

- retry / timeout / heartbeat 由 Temporal Activity policy 承接。
- 每次 attempt 必须投影为 repo-owned sanitized attempt / result record。
- provider / tool / retrieval 调用失败只能写入 bounded failure projection，不得由
  synthesis 补洞。
- activity payload 不得携带 raw browser token、cookie、provider raw trace 或
  unrestricted source body。

### Task Queue

Temporal Task Queue 是 worker dispatch substrate。

第一组 target task queue family：

- `agent.workflow`
- `agent.activity.rag`
- `agent.activity.notice`
- `agent.activity.navigation`
- `agent.activity.campus_services`
- `agent.activity.finalization`
- `agent.activity.projection`

固定规则：

- task queue 按 capability / resource / latency profile 切分，不按 UI surface 切分。
- worker poll task queue 执行 workflow task 或 activity task。
- task queue backlog 是 autoscaling input，不是 product read model。
- task queue 不替代 app-api conversation truth、operator projection 或 eval
  denominator。

### Lane

`Lane` 是 production scheduling 的能力预算维度。

当前 canonical lane family 包括：

- `rag`
- `notice`
- `navigation`
- `campus_services`
- `default`

长期规则：

- lane 预算由 durable scheduler / lease coordinator 拥有。
- lane queue 与 worker pool 可以独立扩容。
- RAG、notice、navigation 与 campus services 不得互相占死 execution capacity。
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

### `execution-gateway`

`execution-gateway` 是 trusted internal execution ingress。

当前实现名仍是 `apps/execution-gateway`；长期概念名是 `execution-gateway`。

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
- domain-agent semantic reasoning
- retrieval backend implementation
- worker autoscaling decision

进程内 lifecycle / admission / queue 只能作为本进程 runtime protection。canonical execution
truth 属于 Temporal workflow / task queue；product truth 属于 repo-owned projection。

### Temporal Runtime Roles

长期 runtime roles 固定为：

- `execution-gateway`
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

### `apps/supervisor-agent-worker`

`apps/supervisor-agent-worker` 长期是 semantic worker。

它负责：

- 消费 Temporal activity task 或 activity 授权的 bounded step payload
- domain-agent dispatch
- prompt runtime / provider client binding
- agent-local tool loop
- retrieval / tool result consumption
- bounded `AgentResponse` / `StepOutputProjection` 产出

它不负责：

- run creation truth
- global admission truth
- product identity truth
- final public response envelope

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

### Identity / Quota Admission

Owner：`apps/app-api` 与 scheduler 共享，但 canonical identity truth 在 `apps/app-api`。

判断：

- user / org / role / session 的预算
- abuse control
- per-conversation active run policy
- restricted visibility posture

### Run Admission

Owner：`execution-gateway` + Temporal workflow admission policy。

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

当前 `EXECUTION_GATEWAY_MAX_CONCURRENT_ANSWERS`、
`EXECUTION_GATEWAY_QUEUE_CAPACITY` 与 `EXECUTION_GATEWAY_QUEUE_TIMEOUT_MS` 只表达
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
- cancel 必须是显式 command，并经过 app-api / supervisor admission。
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

- Go `execution-gateway` execution ingress
- in-process lifecycle registry
- global / per-lane admission
- bounded in-memory queue
- timeout / cancel / drain
- bridge circuit breaker
- metrics / OTel / execution audit seam
- `WorkflowRunStore` foundation for gated multi-step path
- isolated durable runtime store kernel in `apps/execution-gateway/internal/execution`
  for `DurableRun`、`RunEvent`、`ExecutionLease`、`LaneBudget` 与
  `WorkerHeartbeat`
- Postgres-backed durable runtime store foundation with explicit
  `EXECUTION_GATEWAY_DURABLE_RUNTIME_DATABASE_URL` configuration
- retained PG lease coordinator / worker loop / recovery loop code exists as a
  migration artifact, but the online serving path is Temporal-backed. Staging and
  production env must reject `EXECUTION_GATEWAY_DURABLE_WORKER_LOOP_*` and
  `EXECUTION_GATEWAY_DURABLE_RECOVERY_LOOP_*` rather than re-enable PG lease
  execution.
- Temporal owns queued workflow/activity execution, retry, timeout, and worker
  poller readiness. PG durable runtime tables are the sanitized product
  projection store, not the scheduler truth.
- durable cancel command is coordinator-owned: queued / active runs transition
  to `run.canceled`, active leases are released with `lease.released`, and
  active worker execution must accept cooperative bridge cancel propagation
  before the cancel endpoint reports success
- worker completion is lease-owned until the last write: after the bridge returns
  and before any `agent.completed`, browser-visible `finalization.completed` or
  `run.completed` event is appended, the worker must re-read current run and
  lease truth. Terminal run drift, released / expired lease state and lease
  ownership drift fail closed and must not publish a late answer.
- app-api durable runtime adapter and product request cutover foundation:
  accepted chat requests create supervisor durable runs, persist `run_id`
  backlinks in `runtime.request_execution`, and durable-configured blocking /
  stream chat paths poll browser-visible run events by `after_sequence` cursor
  and finalize from `finalization.completed` run event payloads; durable stream
  submit now registers an app-api-owned `waitUntil` finalization closeout before
  emitting `request.accepted`, so browser disconnect no longer owns finalization
- app-api product run command-query endpoints:
  `/api/chat/runs/:runId`, `/api/chat/runs/:runId/events`,
  `/api/chat/runs/:runId/events/stream`, and
  `/api/chat/runs/:runId/cancel` verify local request ownership before proxying
  supervisor durable run status, browser-visible events, browser resume stream,
  and cancel commands
- repo-owned staging durable reconnect harness:
  `pnpm --dir apps/app-api chat:durable:e2e:staging` proves the product stream can
  be disconnected after `request.accepted` and resumed from the existing durable
  run event stream by `run_id + after_sequence`
- repo-owned Postgres durable runtime proof command:
  `apps/execution-gateway/cmd/durable-runtime-proof` creates exact-prefix proof
  artifacts in a real Postgres durable store, verifies multi-worker
  single-lease acquisition, verifies expired-lease retry / terminal recovery,
  writes JSON evidence, restores the pre-existing lane budget, and removes its
  own proof runs / heartbeats
- repo-owned deployed execution-gateway Temporal HTTP proof command:
  `apps/execution-gateway/cmd/temporal-runtime-http-proof` records deployed
  execution-gateway `/readyz` evidence and fails closed unless projection store,
  Temporal runtime, and Temporal workers are all reported ready / started
- public-chat pending-run product baseline: accepted durable run identity is
  persisted in tab-scoped storage, browser resume reads the existing run event
  stream by `run_id + after_sequence`, terminal events load canonical
  conversation truth before clearing pending state, and draft `/chat` routes are
  replaced with the canonical conversation route after recovery
- product run phase projection: app-api maps supervisor durable run status into
  a typed product phase, `request.accepted` emits the created durable run phase,
  public-chat persists that phase in pending-run state, and protected panel
  request detail displays the same phase instead of deriving queue state locally

当前缺口：

- Temporal execution plane 尚未落地：当前仍是 PG-backed run-level durable baseline +
  in-process worker/recovery loop，不是 target workflow/activity/task-queue substrate。
- execution-gateway 概念尚未完成代码/部署收口：当前实现名仍是 `apps/execution-gateway`。
- step-level durable runtime 尚未完整收口：需要补齐 `agent_run_steps`、
  `agent_step_attempts`、`agent_step_results` 的 projection contract、Temporal activity
  mapping、worker writeback 与 panel/eval projection。
- capability worker pool 与 worker autoscaler 尚未落成：当前 worker loop 证明了 PG
  lease-driven consumption foundation，但还没有按 Temporal task queue 独立 worker pool、
  autoscaler desired replicas 与 downstream budget projection 收口。
- RAG 还需要接入 durable typed-tool step graph：retrieval/domain typed
  tools、evidence verifier、replan、synthesis、grounding 与 finalization 需要
  成为可审计 step trajectory，而不是只停在 answer-level run event。
- panel / eval / observability 需要统一到 step-level trajectory：routing、planning、tool、
  retrieval、rerank、selection、synthesis、grounding 应作为诊断阶段进入 badcase、RAGAS、
  golden dataset 与 operator panel projection。

这些 gap 不得通过简单多开实例、HTTP load balancing、Redis queue 或 K8s HPA 标记为已解决。

当前落盘产物：

- `docs/reference/durable-agent-runtime-gap-matrix.md`
  - 当前实现差距矩阵
- `docs/contracts/durable-agent-runtime-contract.md`
  - conversation / run / event / lease / lane 的概念 contract
- `docs/data/durable-agent-runtime-schema.md`
  - durable runtime logical schema
- `apps/execution-gateway/internal/execution/durable_runtime*.go`
  - isolated durable store kernel、lease coordinator、in-memory contract substrate
    与 Postgres store foundation
- `apps/execution-gateway/cmd/durable-runtime-proof`
  - Postgres-backed durable runtime proof command for multi-worker lease and
    expired-lease recovery evidence

## Related Documents

- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/durable-agent-runtime-contract.md`
- `docs/data/durable-agent-runtime-schema.md`
- `docs/reference/durable-agent-runtime-gap-matrix.md`
- `docs/decisions/adr-0047-run-centric-durable-agent-runtime.md`
- `docs/decisions/adr-0048-temporal-execution-plane.md`
