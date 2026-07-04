---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-06-04
updated: 2026-06-12
---
# Durable Agent Runtime Contract

## 文档边界

本文冻结 run-centric durable agent runtime 的稳定 product / projection contract。

它回答的是：

- `Conversation`、`Run`、`RunStep`、`StepAttempt`、`StepResult`、`RunEvent`、
  historical `ExecutionLease` 与 historical `LaneBudget` 的语义
- run lifecycle、step lifecycle、event lifecycle 与 activity attempt projection 如何流转
- app-api、execution-control、Temporal execution plane 与 worker pool 在 durable
  runtime 中的 seam 如何分层

它不负责：

- implementation completion status
- 具体 HTTP path、SQL migration 文件或 worker deployment 数量
- agent-specific payload、retrieval plan、ToolSpec 或 provider schema
- Temporal internal workflow history schema

当前 architecture owner：

- `docs/architecture/system/durable-runtime.md`
- `docs/decisions/adr-0048-temporal.md`

逻辑 schema owner：

- `docs/data/durable-runtime.md`

## Contract Version

当前 contract version 固定为：

`durable-agent-runtime-contract-v1`

破坏性变更必须 bump major，并同步：

- architecture 文档
- data schema 文档
- app-api / execution-control contract
- Operator Console / eval / observability consumer
- fixture / contract tests

## Canonical Identifiers

### `conversation_id`

Conversation id 是 product conversation boundary。

固定规则：

- owner 是 `apps/app-api`
- 只表示用户可见 conversation，不表示 execution run
- 同一个 conversation 默认最多一个 active primary run
- conversation ownership 由 app-api identity / authz truth 判断

### `turn_id`

Turn id 是一次 user input 的 semantic boundary。

固定规则：

- 一个 turn 可以触发一个 primary run
- retry / repair run 必须显式关联 source turn
- turn 不等于 message id；message 是 chat UX record

### `run_id`

Run id 是一次 answer execution 的 canonical durable object id。

固定规则：

- 每次 run 只能有一个 terminal state
- run 可以被查询、取消、订阅、投影和评估
- run id 必须贯穿 workflow/activity projection、run events、final answer 与 eval
  trace / dataset correlation；historical PG lease / heartbeat artifact 只作为迁移审计材料
- `request_id` 只能作为 correlation id，不再作为 final runtime identity

### `step_id`

Step id 是 run 内 typed execution unit id。

固定规则：

- step id 必须在同一 run 内唯一
- Temporal workflow/activity progress 与 repo-owned projection 必须引用明确 step id；
  run-level single-step execution 也必须有 canonical root step id
- step id 必须贯穿 step attempts、step results、tool/retrieval/synthesis events
  与 eval trace / dataset correlation
- step id 不能由 worker 临时生成后只保存在本地内存

### `trace_id`

Trace id 是 observability correlation id。

固定规则：

- trace id 不拥有 lifecycle truth
- trace id 可以与 run id 一对一或一对多，具体由 tracing substrate 决定
- panel/eval 不能只靠 trace id 还原 run truth

## Run Lifecycle

Run status enum 固定为：

- `created`
- `queued`
- `admitted`
- `running`
- `streaming`
- `completed`
- `failed`
- `canceled`
- `expired`

状态语义：

- `created`
  - run 已 durable 创建，但尚未进入 scheduler queue
- `queued`
  - run 已进入 execution plane
  - 等待 Temporal workflow/activity dispatch
- `admitted`
  - execution-control / workflow policy 已允许该 run / step 推进
- `running`
  - workflow/activity worker 已开始执行
- `streaming`
  - run 正在产生 answer-facing output events
- `completed`
  - run 成功产出 terminal answer / clarification / no-answer 等业务 terminal
- `failed`
  - run 因 fail-close、dependency failure、policy failure 或 invariant failure 终止
- `canceled`
  - run 接受 explicit cancel command 后终止
- `expired`
  - workflow/activity 超过 durable timeout 或 heartbeat expiry 后终止

固定规则：

- terminal statuses 是 `completed`、`failed`、`canceled`、`expired`
- terminal state 必须写 `terminal_reason`
- `streaming` 不表示 browser connection active，只表示 run 产生了 streamable output
- `failed` 不允许被无审计地覆盖成 `completed`
- retry 必须写入明确 lease attempt record；repair 如果改变用户可见语义或输入，
  必须创建新 run 或关联 source turn

## Step Lifecycle

Run step status enum 固定为：

- `created`
- `queued`
- `admitted`
- `running`
- `succeeded`
- `failed`
- `blocked`
- `skipped`
- `canceled`
- `expired`

状态语义：

- `created`
  - workflow / planner 已创建 typed step，但尚未进入 step queue
- `queued`
  - step 已进入 Temporal activity task queue
- `admitted`
  - workflow policy 已允许该 step dispatch
- `running`
  - activity worker 已开始执行该 step
- `succeeded`
  - step 已产出符合 output contract 的 typed result
- `failed`
  - step 因 invariant、dependency、provider、retrieval、tool 或 policy failure 终止
- `blocked`
  - step 缺 required projection、authz、freshness、source-trust 或 evidence 条件
- `skipped`
  - step 因 upstream terminal decision 不再需要执行，必须记录 skip reason；典型来源是
    first Execution Agent decision 已产生 direct/no-tool terminal outcome，后续
    tool branch 不应被排队
- `canceled`
  - step 随 run explicit cancel 或 step-local cancel 终止
- `expired`
  - step / activity 超过 durable timeout 或 heartbeat expiry 后终止

固定规则：

- terminal step statuses 是 `succeeded`、`failed`、`blocked`、`skipped`、`canceled`、
  `expired`
- 每个非 terminal step 必须可被 workflow/projection 查询并与 Temporal task queue /
  downstream budget 对齐
- required dependency 未完成时不得执行 step
- worker 不得直接把 step 从 `queued` 改成 terminal；必须由 Temporal
  activity dispatch 授权
- step terminal state 必须写 `terminal_reason` 或 `blocker_reason`

## Step Attempt Contract

每个 attempt 至少包含：

- `attempt_id`
- `run_id`
- `step_id`
- `lease_id`（historical PG baseline only）
- `worker_id`
- `attempt_no`
- `status`
- `started_at`
- `completed_at`
- `terminal_reason`
- `failure_kind`
- `metadata`

固定规则：

- retry 必须递增 `attempt_no`
- target architecture 中 attempt 必须关联 Temporal activity attempt / workflow
  execution；historical PG baseline 中 attempt 与 lease 必须一一关联
- attempt payload 必须是 sanitized execution summary，不保存 raw prompt、raw provider
  response、raw source body、auth material 或 object-store credentials
- failed attempt 只能通过后续 attempt 或 terminal step event 关闭，不得原地改写为 success

## Step Result Contract

每个 step result 至少包含：

- `result_id`
- `run_id`
- `step_id`
- `attempt_id`
- `result_kind`
- `visibility`
- `payload_schema_version`
- `payload`
- `created_at`

`result_kind` 第一版固定包括：

- `typed_tool_result`
- `agent_output_projection`
- `retrieval_query_activity`
- `supporting_evidence`
- `grounding_verdict`
- `synthesis_draft_projection`
- `finalization_projection`

固定规则：

- result payload 必须是 bounded sanitized projection
- deterministic data access 输出 `typed_tool_result`
- semantic specialist 输出 `agent_output_projection`
- retrieval step 输出 `retrieval_query_activity` 与 supporting evidence projection
- synthesis 不得伪造缺失 tool / retrieval result
- grounding verdict 不得读取 raw provider transcript；只能消费 final answer projection 与
  supporting evidence projection
- browser、panel、eval 只能读取 result projection 或由 result 派生的 read model

## Terminal Reason

`terminal_reason` 至少固定以下 family：

- `answer_completed`
- `clarification_required`
- `no_answer_grounded`
- `policy_rejected`
- `tool_closed`
- `conversation_active_run`
- `quota_exceeded`
- `queue_timeout`
- `lease_expired`
- `worker_unavailable`
- `provider_unavailable`
- `retrieval_unavailable`
- `runtime_invariant_failed`
- `user_canceled`
- `system_draining`
- `run_timeout`

固定规则：

- terminal reason 是 low-cardinality operational reason
- human-facing message 不得替代 terminal reason
- fail-close reason 可以比 terminal reason 更细，但必须映射到 terminal reason family

## Run Event Contract

Run event schema family 固定为：

`run-event-v1`

每个 event 至少包含：

- `event_id`
- `run_id`
- `conversation_id`
- `event_type`
- `sequence`
- `occurred_at`
- `visibility`
- `payload`
- `payload_schema_version`

`event_type` 第一版固定为：

- `run.created`
- `run.queued`
- `run.admitted`
- `run.started`
- `run.streaming_started`
- `run.output_delta`
- `run.answer_started`
- `run.answer_delta`
- `run.answer_completed`
- `run.completed`
- `run.failed`
- `run.canceled`
- `run.expired`
- `lease.acquired`
- `lease.heartbeat`
- `lease.released`
- `lease.expired`
- `workflow.planned`
- `step.created`
- `step.queued`
- `step.admitted`
- `step.started`
- `step.completed`
- `step.failed`
- `step.blocked`
- `step.skipped`
- `step.expired`
- `step_attempt.started`
- `step_attempt.completed`
- `step_result.created`
- `agent.started`
- `agent.completed`
- `agent.failed`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `retrieval.planned`
- `retrieval.completed`
- `finalization.completed`

固定规则：

- event sequence 在同一 run 内单调递增
- event payload 必须是 sanitized projection
- event 不能保存 raw prompt、raw provider response、raw auth material、raw transcript、
  raw source body 或 raw object-store bytes
- browser stream、panel、eval 与 audit 只能消费 run event projection 或由它派生的 read
  model

## Execution Dispatch Contract

Target architecture 中 execution dispatch 由 Temporal workflow / activity task
queue 承接。

Historical PG baseline 使用 execution lease projection，状态 enum 固定为：

- `available`
- `leased`
- `released`
- `expired`
- `revoked`

每个 lease 至少包含：

- `lease_id`
- `run_id`
- `step_id`
- `execution_group`
- `worker_id`
- `attempt`
- `status`
- `acquired_at`
- `heartbeat_at`
- `expires_at`
- `released_at`
- `release_reason`

固定规则：

- worker 只有收到 Temporal activity task 才能执行 step；historical PG baseline worker
  曾要求持有 active lease 才能执行 run / step
- activity 必须按 Temporal policy heartbeat；historical PG baseline lease 必须定期
  heartbeat
- Temporal 根据 timeout / heartbeat 处理 activity retry；historical PG baseline
  scheduler 曾根据 expiry 回收 lease
- historical expired lease recovery 未达到显式 retry 上限时，可以把同一 run 重新写为
  `queued`，并必须通过新的 lease `attempt` 和 `run.queued` event 暴露 retry
  provenance；达到上限后才写 `run.expired`
- worker 不得通过本地状态伪造全局 admission
- historical lease release 必须写 run event；当前 serving cancel / retry / timeout
  provenance 来自 Temporal workflow/activity 与 sanitized projection

## Canonical Queue Contract

canonical execution queue 固定由 Temporal Task Queue 表达：

- workflow task queue
- activity task queue
- worker polling
- Temporal retry / timeout / heartbeat semantics

historical PG baseline queue 曾由 PG durable rows 表达；它不是 current online
serving truth：

- queued run：`runtime.agent_runs.status='queued'`
- queued step：`runtime.agent_run_steps.status='queued'`

消费规则：

- historical scheduler 使用 `FOR UPDATE SKIP LOCKED` 选择候选 queued rows
- historical scheduler 在同一事务内检查 execution-group budget、worker readiness、dependency
  state 与 downstream budget
- historical scheduler 创建 execution lease 并写 admission event 后，worker 才能执行
- 当前 online serving 不得直接扫描 queued rows 或重启 lease path
- process-local queue 只能作为本进程 protection，不是 canonical queue
- Redis 不得作为 canonical queue；只能作为非权威 wakeup、fanout、cache 或 derived counter

## Historical PG Budget Artifact

historical PG baseline 每个 execution-group budget 至少包含：

- `execution_group`
- `max_active_leases`
- `max_queued_runs`
- `queue_timeout_ms`
- `run_timeout_ms`
- `lease_timeout_ms`
- `worker_heartbeat_timeout_ms`

固定规则：

- global budget、Temporal worker scaling policy 与 downstream budget 必须同时满足
- historical execution-group budget 不参与当前 online serving scheduler
- per-user / per-org / per-conversation budget 不得由 execution-group budget 代替
- downstream resource budget 可以收敛到 worker-autoscaler / execution policy input，
  但不得被 worker 私自绕过

## Conversation Active Run Policy

默认 policy 固定为：

`reject_new_primary_run`

语义：

- 如果同一 conversation 已有 active primary run，新的 primary run creation 返回
  `conversation_active_run`
- active statuses 包括 `created`、`queued`、`admitted`、`running`、`streaming`
- terminal run 不阻止新 run

未来允许的显式 policy：

- `enqueue_after_active_run`
- `cancel_active_then_start`
- `interrupt_active_run`

这些 policy 不能静默启用；必须进入 product contract、operator observability 与 eval。

## Runtime Seams

### App API

app-api owns：

- create run command
- get run query
- list conversation runs query
- cancel run command
- subscribe run events stream
- conversation active-run admission
- browser-facing error envelope

### Execution Control

execution-control owns：

- run command-query、workflow start/cancel/signal/query/update、readyz/metrics 与
  projection
- deterministic workflow planning、finalization 与 fail-close terminal mapping
- Temporal client ownership for workflow command/query

Temporal owns：

- workflow state and history
- workflow / activity task queues
- retry / timeout / heartbeat / timer mechanics
- worker dispatch through polling

Worker pools own：

- workflow task execution
- activity task execution
- typed tool / agent-as-tool step execution
- sanitized step attempt / result writeback

Execution durable run create command 固定要求：

- `metadata.execution_payload` 必须存在且为 object
- `metadata.execution_payload.request_id` 必须等于外层 `request_id`
- `metadata.execution_payload.conversation_id` 必须等于外层 `conversation_id`
- 如果外层 `trace_id` 非空，`metadata.execution_payload.trace_id` 必须等于外层
  `trace_id`
- `metadata.execution_payload.user_goal` 必须存在且非空
- app-api 不得在 durable run create metadata 中写 `handoff`；RAG tool branch 的 handoff
  planning 由 Execution Agent Layer 根据 `execution_payload` 派生

### Worker Pool

worker pool owns：

- Temporal workflow / activity task consumption
- Temporal activity heartbeat where required by policy
- typed tool / agent-as-tool step execution
- run event writeback
- step attempt / result writeback

worker pool does not own：

- product identity
- conversation ownership
- global admission truth
- public final response envelope
- run / step admission truth

## Retired Transport Boundary

The retired legacy answer transport is not part of the active `app-api ->
execution-control` serving path.

The active internal execution seam is the Temporal-backed run command/query
contract:

- `POST /internal/execution/runs`
- `GET /internal/execution/runs/:runId`
- `GET /internal/execution/runs/:runId/events`
- `GET /internal/execution/runs/:runId/steps`
- `POST /internal/execution/runs/:runId/cancel`

`GET /internal/execution/runs/:runId/steps` returns the sanitized step
trajectory for app-api materialization. It must include the available
`RunStep`、`StepAttempt` 与 `StepResult` projection needed to build operator
`runtimeRun.operatorStepTrajectory`: step identity、tool、status、Temporal
task-queue / worker metadata、attempt/result count、queue wait、duration、
provider/model usage、token/cost、cancel / timeout outcome、fail-close reason、
replan reason、late-completion outcome 与 result refs. It is an internal
execution query seam, not a browser-facing trace replay endpoint.

Implementation may bridge request execution into durable run records, but it must
not add fallback behavior or silently synthesize missing run / step fields.
Missing required run projection state must fail closed.

新增 tool opening gate 不得只证明 typed tool / worker 函数可执行；它必须证明
normal、fail-close、cancel、timeout、late completion 与 replan outcome 可以进入
step/attempt/result projection，并能被 app-api operator read model 消费。

## Operator Step Trajectory Export

`runtimeRun.operatorStepTrajectory` 是 app-api 面向 panel、eval、badcase 与 operational
diagnostic artifact 的唯一 canonical diagnostic export。它不是 raw Temporal replay，
也不是 execution-control `/steps` response 的浏览器透传。`runtimeRun.stepTrajectory`
只保留 request detail 的 bounded display summary，不再是 eval / badcase /
diagnostic fixture 的 canonical source。

第一版 export contract 固定为 `operator_step_trajectory.v1`：

- source owner：`apps/app-api`
- source input：app-api materialized operator request detail，或测试中与该 detail
  同形的 sanitized fixture
- consumers：Operator Console request detail、eval attribution、badcase projection、
  diagnostic fixture builder
- forbidden consumers：Temporal history reader、execution-control direct query from
  eval / panel、provider raw trace reader、raw prompt / raw answer / raw transcript
  reader、本机 object path / bucket / local artifact reverse lookup

每个 diagnostic step item 至少承载：

- `step_id`
- `step_kind`
- `tool`
- `tool_name`
- `status`
- `attempt_count`
- `queue_wait_ms`
- `duration_ms`
- task queue / worker metadata where available
- provider / model / token / estimated cost metadata where available
- `fail_close_reason`
- `terminal_reason`
- `replan_reason`
- `cancel_outcome`
- `timeout_outcome`
- `late_completion_outcome`
- bounded result / evidence / artifact projection refs where available

Eval / badcase / diagnostic fixture rules：

- 不允许直接消费 `workflow_trace_summary` 作为 canonical source；它只能作为 bounded
  display summary。
- failure stage attribution 必须支持 routing / primary-agent / typed-tool /
  retrieval / rerank / selection / evidence-selection / synthesis / grounding /
  finalization / replan，以及 terminal outcome stage
  (`clarification` / `needs_clarification` / `rejected` / `no_answer`) 的 common
  alias；terminal outcome stage 归因到 `finalization.write`。无法匹配时仍返回
  `attribution_missing`。
- local fixture summary 必须统计 timeout、cancel、late-completion、
  fail-close reason 与 replan reason counts；这些 counts 是 diagnostic local
  evidence，不等于 deployment validation。
- 无法把 failure stage 绑定到 step trajectory 时，必须输出
  `trajectory_missing` 或 `attribution_missing`，不得从 raw artifact 或 sink trace 猜测。
- deployment run、Temporal metrics sampling、schedule-to-start measurement 与
  release closeout 不属于该 contract 的语义 owner；它们只能通过同一
  export contract 形成受控诊断输入。
