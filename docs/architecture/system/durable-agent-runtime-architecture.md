---
doc_type: architecture
status: active
created: 2026-06-04
updated: 2026-06-05
---
# Durable Agent Runtime Architecture

## 文档边界

本文冻结 `campus-agent` 长期 production agent runtime 的 durable execution
supporting architecture。

它回答的是：

- 一次用户回答的 canonical execution object 是什么
- conversation、run、event、lease、lane 与 worker pool 的长期关系是什么
- production 并发预算、排队、取消、恢复、step execution 与 streaming 应由哪一层拥有
- `supervisor-api` 作为代码域如何拆成 control / scheduler / recovery / lane worker
  / autoscaler roles

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
and run store -> PG-backed queued run / queued step rows -> scheduler / lease
coordinator -> lane worker pools -> typed step results -> run events -> app-api
stream / projection -> browser surface`

核心规则：

- HTTP request 不等于 agent execution lifetime。
- `run_id` 是一次回答的 canonical execution object。
- `conversation_id` 是上下文、权限、memory 与同会话并发策略的边界。
- `run_events` 是 streaming、trace、audit、operator projection 与 eval backlink 的共同事实源。
- production admission truth 不得只存在于某个 `supervisor-api` 进程内存。
- process-local limiter 只能作为单进程 runtime protection，不能作为全局 production
  scheduler。
- PG 是 canonical execution truth；Redis 只能做非权威 wakeup / live fanout / cache，不得作为
  run、queue、lease、event 或 terminal state truth。
- K8s 只调度 pod / resource，不拥有 queue、lease、run、event 或 terminal truth。

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

`Run` 是一次 agent answer execution 的 canonical durable object。

最小生命周期固定为：

`created -> queued -> admitted -> running -> streaming -> completed / failed /
canceled / expired`

固定规则：

- 创建 run 不表示已经开始执行。
- run admission 与 execution lease 是两个不同动作。
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

### Execution Lease

`ExecutionLease` 是 worker 对某个 run / step 的执行权。

长期 owner 固定为 scheduler / lease coordinator。

它至少承载：

- lease id
- run id / step id
- lane
- worker id / owner
- acquired at / heartbeat at / expires at
- attempt
- terminal handoff reason

固定规则：

- worker 只有拿到 lease 才能执行 run / step。
- lease 必须可过期、可观测、可回收。
- worker crash 后，scheduler 依据 lease heartbeat / expiry 重新决定 run terminal 或重新入队。
- lease truth 不得只存在于 worker 内存。

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

### `apps/supervisor-api`

`apps/supervisor-api` 是 deterministic execution code domain，不等于单一部署职责。

代码域负责提供：

- run admission facade
- scheduler / lease coordinator 或其 repo-owned adapter
- workflow planning
- global / lane / actor / conversation / provider budget decision
- execution lease creation and release semantics
- cancel / timeout / drain semantics
- finalization
- runtime metrics、audit 与 trace projection

它不负责：

- product-layer auth/session/conversation ownership
- browser-facing capability policy
- domain-agent semantic reasoning
- retrieval backend implementation

进程内 lifecycle / admission / queue 只能作为本进程 runtime protection。canonical queue 与
execution truth 必须在 PG durable rows、scheduler decision、lease 与 run event 中。

### Supervisor Runtime Roles

同一 `apps/supervisor-api` code domain 在部署上拆成以下 roles：

- `supervisor-api-control`
  - 承接 internal HTTP / command-query surface、run create / cancel / query、
    readyz / metrics 与 operator-safe projection。
- `supervisor-scheduler`
  - 扫描 queued run / queued step rows，基于 lane budget、worker readiness、downstream
    budget 与 `FOR UPDATE SKIP LOCKED` 获取调度窗口，写入 admission event 与 execution
    lease。
- `supervisor-recovery`
  - 回收 expired leases、timed-out runs / steps、stale worker heartbeat，并写入 retry /
    terminal events。
- `supervisor-worker-{lane}`
  - 只消费对应 lane 的 execution lease，执行 typed step，写入 step attempt / result / run
    event；不得拥有 global admission truth。
- `worker-autoscaler`
  - 读取 sanitized backlog、lease、heartbeat 与 lane budget projection，只调整
    `supervisor-worker-{lane}` replica count。它不得写 run、step、lease、event 或 terminal
    state。

### `apps/supervisor-agent-worker`

`apps/supervisor-agent-worker` 长期是 semantic worker。

它负责：

- 消费 execution lease 或由 lease 授权的 step payload
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

- 每个 worker 只能执行 lease 授权的 typed step。
- lane worker pool 可以横向扩容；扩容只增加消费能力，不改变 queue / lease truth。
- worker pool 不写 global budget、不决定 terminal state、不绕过 scheduler。
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

Owner：`apps/supervisor-api` durable scheduler。

判断：

- 是否允许创建或推进一个 run
- workflow mode 是否打开
- selected capability / lane 是否可用
- required context projection 是否满足

### Execution Lease Admission

Owner：scheduler / lease coordinator。

判断：

- 当前 lane 是否还有执行预算
- downstream provider / retrieval / database 是否还有预算
- worker 是否符合该 step 的 capability / version / readiness 条件
- lease 是否可创建、续租或回收

当前 `SUPERVISOR_API_MAX_CONCURRENT_ANSWERS`、`SUPERVISOR_API_QUEUE_CAPACITY` 与
`SUPERVISOR_API_QUEUE_TIMEOUT_MS` 只表达 current process-local execution protection。
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

scheduler 必须支持：

- global active lease budget
- per-lane active lease budget
- per-user / per-org active run and queued run budget
- per-conversation active run policy
- downstream resource budget
- lease heartbeat / expiry
- worker crash detection
- run timeout and step timeout
- drain and deployment handoff
- terminal state projection

canonical queue 形态固定为：

- queued run rows：`runtime.agent_runs.status='queued'`
- queued step rows：`runtime.agent_run_steps.status='queued'`
- scheduler 使用 `FOR UPDATE SKIP LOCKED` 领取候选 rows
- scheduler 在同一事务中检查 lane budget / worker readiness / downstream budget，并写
  execution lease 与 admission event
- worker 只消费 lease，不直接扫描 queued rows 来决定是否执行

Redis 不进入 canonical queue path。允许的 Redis 用途只包括：

- 非权威 wakeup signal
- browser live fanout 加速
- cache / invalidation
- derived dashboard counter

Redis 丢失、flush、延迟或重启不得导致 run、step、lease、event 或 terminal state 丢失，也不得让
worker 绕过 PG scheduler。

失败处理固定为 fail closed：

- run store unavailable：不能创建新的 run
- scheduler unavailable：不能 admit execution lease
- worker readiness mismatch：不能领取对应 lane lease
- required projection missing：run 进入 terminal failed / clarification path
- lease metadata drift：不得执行该 step

## Deployment Substrate And Autoscaling Boundary

runtime 语义不绑定某个 vendor substrate；但 canonical execution truth 固定在 PG durable
runtime schema 中。

repo-owned durable substrate 固定为：

`Postgres-backed run / step store + scheduler / lease coordinator`

原因：

- repo 已拥有 Postgres product/runtime schema boundary
- `apps/supervisor-api` 已是 Docker-first internal execution service
- self-hosted data plane 已有 Postgres / Qdrant / object store 运维边界
- PG row lock、transaction、index 与 audit model 可以直接表达 execution truth

Temporal、Cloudflare Workflows、Cloudflare Queues 或其他 durable execution
substrate 只能作为 implementation substrate 替换；它们不得改变本文冻结的
conversation、run、step、attempt、result、event、lane、lease 与 worker pool 语义。

K8s 边界固定为：

- K8s 调度 pod、resource request/limit、service discovery、rollout、liveness/readiness。
- K8s 不拥有 run queue、step queue、execution lease、lane budget、run event 或
  terminal state。
- K8s Job / CronJob / HPA / KEDA 只能基于 PG-derived metrics 调整 worker presence；不能成为
  canonical scheduler。

worker autoscaler 边界固定为：

- 输入：sanitized lane backlog、oldest queued age、active leases、worker
  heartbeat、downstream budget projection、SLO target。
- 输出：每个 `supervisor-worker-{lane}` 的 desired replica count。
- 禁止：写 run / step / lease / event、改变 lane budget、修改 queued rows、直接标记 terminal
  state、基于 raw prompt 或 raw provider trace 做扩缩容。

## Current Implementation State

当前实现已经具备：

- Go `supervisor-api` execution ingress
- in-process lifecycle registry
- global / per-lane admission
- bounded in-memory queue
- timeout / cancel / drain
- bridge circuit breaker
- metrics / OTel / execution audit seam
- `WorkflowRunStore` foundation for gated multi-step path
- isolated durable runtime store kernel in `apps/supervisor-api/internal/execution`
  for `DurableRun`、`RunEvent`、`ExecutionLease`、`LaneBudget` 与
  `WorkerHeartbeat`
- Postgres-backed durable runtime store foundation with explicit
  `SUPERVISOR_API_DURABLE_RUNTIME_DATABASE_URL` configuration
- durable lease coordinator foundation that atomically selects queued runs,
  admits them, creates execution leases and appends run events
- supervisor-owned durable worker loop foundation with explicit
  `SUPERVISOR_API_DURABLE_WORKER_LOOP_*` configuration, startup lane-budget sync,
  worker heartbeat registration, lease polling and readyz projection; lane budget
  backpressure is a non-terminal polling outcome, not a worker process fatal
  error
- supervisor-owned durable recovery loop foundation with explicit
  `SUPERVISOR_API_DURABLE_RECOVERY_LOOP_*` configuration and readyz projection;
  this loop does not acquire leases or execute agent work
- explicit expired-lease / timed-out-run recovery in the durable scheduler:
  recovery marks stale active leases as `lease.expired`; if the configured
  `SUPERVISOR_API_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS` has not been
  reached, the run is re-queued with an incremented lease attempt, otherwise it
  transitions to `run.expired` with `lease_expired`; queued runs past
  `queue_timeout` transition to `run.expired` with `queue_timeout`, and active
  runs past `run_timeout` release their active lease with `run_timeout`
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
  `apps/supervisor-api/cmd/durable-runtime-proof` creates exact-prefix proof
  artifacts in a real Postgres durable store, verifies multi-worker
  single-lease acquisition, verifies expired-lease retry / terminal recovery,
  writes JSON evidence, restores the pre-existing lane budget, and removes its
  own proof runs / heartbeats
- repo-owned deployed supervisor durable HTTP proof command:
  `apps/supervisor-api/cmd/durable-runtime-http-proof` records deployed
  supervisor `/readyz` evidence and fails closed unless durable store, worker
  loop and recovery loop are all reported ready / started
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

- runtime role split 尚未落成独立部署职责：`supervisor-api-control`、
  `supervisor-scheduler`、`supervisor-recovery`、`supervisor-worker-{lane}` 与
  `worker-autoscaler` 仍需按 role 拆分运行、配置、readyz 与 evidence。
- step-level durable runtime 尚未完整收口：需要补齐 `agent_run_steps`、
  `agent_step_attempts`、`agent_step_results` 的 migration、store contract、scheduler
  事务、worker writeback 与 panel/eval projection。
- multi-lane worker pool 与 worker autoscaler 尚未落成：当前 worker loop 证明了 lease-driven
  consumption foundation，但还没有按 lane 独立 pool、autoscaler desired replicas 与
  downstream budget projection 收口。
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
- `apps/supervisor-api/internal/execution/durable_runtime*.go`
  - isolated durable store kernel、lease coordinator、in-memory contract substrate
    与 Postgres store foundation
- `apps/supervisor-api/cmd/durable-runtime-proof`
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
