---
doc_type: contract
status: active
created: 2026-06-04
updated: 2026-06-04
---
# Durable Agent Runtime Contract

## 文档边界

本文冻结 run-centric durable agent runtime 的稳定概念 contract。

它回答的是：

- `Conversation`、`Run`、`RunEvent`、`ExecutionLease` 与 `LaneBudget` 的语义
- run lifecycle、event lifecycle、lease lifecycle 如何流转
- app-api、supervisor-api 与 worker pool 在 durable runtime 中的 seam 如何分层

它不负责：

- 当前代码是否已经实现这些接口
- 具体 HTTP path、SQL migration 文件或 worker deployment 数量
- agent-specific payload、retrieval plan、ToolSpec 或 provider schema

当前 architecture owner：

- `docs/architecture/system/durable-agent-runtime-architecture.md`
- `docs/decisions/adr-0047-run-centric-durable-agent-runtime.md`

逻辑 schema owner：

- `docs/data/durable-agent-runtime-schema.md`

## Contract Version

当前 contract version 固定为：

`durable-agent-runtime-contract-v1`

破坏性变更必须 bump major，并同步：

- architecture 文档
- data schema 文档
- app-api / supervisor-api contract
- panel / eval / observability consumer
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
- run id 必须贯穿 run events、lease、worker heartbeat、final answer 与 eval backlink
- `request_id` 只能作为 compatibility / correlation id，不再作为 final runtime identity

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
  - run 已进入 durable lane queue，等待 execution lease
- `admitted`
  - scheduler 已允许该 run / step 获取 execution lease
- `running`
  - worker 已持有 active lease 并开始执行
- `streaming`
  - run 正在产生 answer-facing output events
- `completed`
  - run 成功产出 terminal answer / clarification / no-answer 等业务 terminal
- `failed`
  - run 因 fail-close、dependency failure、policy failure 或 invariant failure 终止
- `canceled`
  - run 接受 explicit cancel command 后终止
- `expired`
  - run / lease 超过 durable timeout 或 heartbeat expiry 后终止

固定规则：

- terminal statuses 是 `completed`、`failed`、`canceled`、`expired`
- terminal state 必须写 `terminal_reason`
- `streaming` 不表示 browser connection active，只表示 run 产生了 streamable output
- `failed` 不允许被无审计地覆盖成 `completed`
- retry 必须写入明确 lease attempt record；repair 如果改变用户可见语义或输入，
  必须创建新 run 或关联 source turn

## Terminal Reason

`terminal_reason` 至少固定以下 family：

- `answer_completed`
- `clarification_required`
- `no_answer_grounded`
- `policy_rejected`
- `capability_closed`
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
- `run.completed`
- `run.failed`
- `run.canceled`
- `run.expired`
- `lease.acquired`
- `lease.heartbeat`
- `lease.released`
- `lease.expired`
- `workflow.planned`
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

## Execution Lease Contract

Execution lease status enum 固定为：

- `available`
- `leased`
- `released`
- `expired`
- `revoked`

每个 lease 至少包含：

- `lease_id`
- `run_id`
- `step_id`
- `lane`
- `worker_id`
- `attempt`
- `status`
- `acquired_at`
- `heartbeat_at`
- `expires_at`
- `released_at`
- `release_reason`

固定规则：

- worker 只有持有 active lease 才能执行 run / step
- lease 必须定期 heartbeat
- scheduler 可以根据 expiry 回收 lease
- expired lease recovery 未达到显式 retry 上限时，可以把同一 run 重新写为
  `queued`，并必须通过新的 lease `attempt` 和 `run.queued` event 暴露 retry
  provenance；达到上限后才写 `run.expired`
- worker 不得通过本地状态伪造全局 admission
- lease release 必须写 run event

## Lane Budget Contract

Lane enum 第一版固定为：

- `rag`
- `notice`
- `navigation`
- `campus_services`
- `default`

每个 lane budget 至少包含：

- `lane`
- `max_active_leases`
- `max_queued_runs`
- `queue_timeout_ms`
- `run_timeout_ms`
- `lease_timeout_ms`
- `worker_heartbeat_timeout_ms`

固定规则：

- global budget 与 lane budget 必须同时满足
- per-user / per-org / per-conversation budget 不得由 lane budget 代替
- downstream resource budget 可以收敛到 scheduler input，但不得被 worker 私自绕过

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

### Supervisor API

supervisor-api owns：

- run admission decision
- workflow planning
- lane selection
- lease coordinator or durable scheduler adapter
- finalization
- fail-close terminal mapping

Supervisor durable run create command 固定要求：

- `metadata.execution_payload` 必须存在且为 object
- `metadata.execution_payload.request_id` 必须等于外层 `request_id`
- `metadata.execution_payload.conversation_id` 必须等于外层 `conversation_id`
- 如果外层 `trace_id` 非空，`metadata.execution_payload.trace_id` 必须等于外层
  `trace_id`
- `metadata.execution_payload.user_goal` 必须存在且非空
- app-api 不得在 durable run create metadata 中写 `handoff`；RAG lane 的 handoff
  planning 由 supervisor 根据 `execution_payload` 派生

### Worker Pool

worker pool owns：

- lease consumption
- heartbeat
- domain-agent execution
- run event writeback
- terminal result writeback

worker pool does not own：

- product identity
- conversation ownership
- global admission truth
- public final response envelope

## Compatibility Boundary

Current `POST /api/v1/answer` and `POST /api/v1/answer/stream` remain current
implementation transports until durable run endpoints are implemented.

They must be interpreted as compatibility transports, not final production run
contract.

Implementation may bridge current request execution into durable run records during
cutover, but it must not add fallback behavior or silently synthesize missing run
fields. Missing required durable runtime state must fail closed.
