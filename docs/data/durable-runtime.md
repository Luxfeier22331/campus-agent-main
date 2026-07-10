---
doc_type: data
truth_scope: data
owner_boundary: apps/execution-control
status: active
created: 2026-06-04
updated: 2026-06-11
---
# Durable Agent Runtime Schema

## 文档边界

本文冻结 run-centric durable agent runtime 的 product / projection 逻辑数据模型。

它回答的是：

- 哪些 logical tables / records 拥有 product runtime projection truth
- conversation、run、step、attempt、result、event 如何关联
- 哪些字段是 canonical truth，哪些只是 projection / correlation

它不负责：

- 具体 migration 文件名
- 物理分库 / 分区策略
- SQL DDL 的完整列类型和索引语法
- implementation completion status
- Temporal internal workflow history schema

稳定 contract 见：

- `docs/contracts/durable-runtime.md`

## Logical Schema Namespace

第一版逻辑 schema 固定使用：

`runtime.*`

原因：

- app-api 已拥有 `runtime.request_execution` 与 `runtime.projection_outbox`
- run projection 是 product/runtime projection truth，不属于 `chat.*`
- worker dispatch 与 scheduler truth 由 Temporal Task Queue / Activity policy 承接

## Table Overview

active product projection tables：

- `runtime.agent_runs`
- `runtime.agent_run_steps`
- `runtime.agent_step_attempts`
- `runtime.agent_step_results`
- `runtime.agent_run_events`
- `runtime.conversation_run_locks`

现有表关系：

- `runtime.request_execution`
  - current request projection truth
  - 后续通过 `run_id` 与 `runtime.agent_runs` 关联
- `runtime.projection_outbox`
  - current operator projection outbox
  - 后续可由 run events 派生或携带 run backlink
- `chat.conversations`
  - conversation ownership truth
  - 不拥有 execution scheduler truth
- `chat.messages`
  - user / assistant UX message truth
  - 不拥有 run lifecycle truth

## Queue Model

canonical execution queue 固定由 Temporal Task Queue 表达；PG 表达的是
product run / step projection 与 operator/eval read model。

target queue model：

- workflow task queue
- activity task queue
- worker polling
- Temporal retry / timeout / heartbeat semantics

- process-local queue 只能作为本进程 protection，不是 canonical execution queue
- Redis 只能用于非权威 wakeup、live fanout、cache 或 derived counter；不拥有 run、step、
  lease、event 或 terminal truth

## `runtime.agent_runs`

用途：

- answer-level product run projection truth

最小列：

- `run_id`
- `conversation_id`
- `turn_id`
- `request_id`
- `trace_id`
- `owner_user_id`
- `surface`
- `requested_tool`
- `selected_tool`
- `task_queue`
- `status`
- `terminal_reason`
- `fail_close_reason`
- `retryable`
- `created_at`
- `queued_at`
- `admitted_at`
- `started_at`
- `streaming_started_at`
- `completed_at`
- `updated_at`
- `runtime_versions_json`
- `workflow_plan_ref`
- `final_response_ref`
- `metadata_json`

最小索引：

- primary key `(run_id)`
- `(conversation_id, created_at desc)`
- `(request_id)`
- `(trace_id)`
- `(status, task_queue, created_at)`
- partial unique active primary run by `conversation_id`

`status` enum：

- `created`
- `queued`
- `admitted`
- `running`
- `streaming`
- `completed`
- `failed`
- `canceled`
- `expired`

规则：

- terminal statuses 必须写 `terminal_reason`
- active statuses 不允许写 `completed_at`
- `request_id` 是 correlation，不能替代 `run_id`
- `owner_user_id` 是 app-api 投影后的 principal id，不从 execution-control header 反推
- `metadata_json` 不保存 raw prompt、raw answer、provider raw response、auth
  material 或 restricted raw body
- `metadata_json.execution_payload` 是 app-api 提供给 execution-control 的执行投影；它必须
  与外层 `request_id`、`conversation_id` 和非空 `trace_id` 对齐，且必须包含非空
  `user_goal`
- `metadata_json` 不允许由 app-api 写入 tool `handoff`；routing /
  branch planning 属于 execution-control Execution Agent Layer

## `runtime.agent_run_events`

用途：

- append-only run event stream

最小列：

- `event_id`
- `run_id`
- `conversation_id`
- `sequence`
- `event_type`
- `visibility`
- `payload_schema_version`
- `payload_json`
- `occurred_at`
- `created_at`

最小索引：

- primary key `(event_id)`
- unique `(run_id, sequence)`
- `(run_id, occurred_at)`
- `(conversation_id, occurred_at desc)`
- `(event_type, occurred_at desc)`

规则：

- 同一 run 内 sequence 单调递增
- event append 后不得更新 payload
- correction 必须追加新 event，不修改旧 event
- payload 必须是 sanitized projection
- browser stream、panel、eval 与 audit 读取 event projection 或 read model，不读取 raw
  provider trace

## `runtime.agent_run_steps`

用途：

- step-level product / eval projection truth

## Step Trajectory Projection Spine

`runtime.agent_run_steps`、`runtime.agent_step_attempts` 与
`runtime.agent_step_results` 共同组成 operator / eval / badcase 的 step trajectory
projection spine。

固定语义：

- `agent_run_steps` 表达 workflow plan admitted 的 typed execution unit。
- `agent_step_attempts` 表达 Temporal activity attempt / worker execution evidence。
- `agent_step_results` 表达 bounded sanitized output projection。
- panel、eval、badcase 与 operational diagnostic artifact 只能读取这些 projection 或由 app-api
  materialize 的 read model，不读取 Temporal raw history、runtime event string 或
  provider trace。
- cancel、timeout、fail-close、late completion、bounded replan、provider abort
  proven / unproven 与 provider usage missing 必须有 step / attempt / result 级归因；
  不能只写在 run-level terminal reason、workflow trace summary 或 sink event 中。

最小列：

- `step_id`
- `run_id`
- `parent_step_id`
- `dependency_step_ids_json`
- `task_queue`
- `tool_surface`
- `step_kind`
- `target_id`
- `target_kind`
- `status`
- `terminal_reason`
- `blocker_reason`
- `created_at`
- `queued_at`
- `admitted_at`
- `started_at`
- `completed_at`
- `updated_at`
- `input_projection_refs_json`
- `output_contract_json`
- `budget_json`
- `metadata_json`

最小索引：

- primary key `(run_id, step_id)`
- `(run_id, status, created_at)`
- `(task_queue, status, created_at)`
- `(target_kind, target_id, status)`
- `(status, queued_at)`

`status` enum：

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

规则：

- `step_id` 在同一 run 内唯一
- dependency step 未 terminal 且满足 output contract 前，不得执行 dependent step
- `target_kind` 固定区分 `typed_tool`、`agent_as_tool`、`retrieval`、`synthesis`、
  `grounding`、`finalization`
- terminal statuses 必须写 `terminal_reason` 或 `blocker_reason`
- `input_projection_refs_json` 只能保存 sanitized projection refs，不保存 raw prompt、
  raw provider response、raw source body 或 auth material

## `runtime.agent_step_attempts`

用途：

- worker 对某个 step 的 attempt projection truth；当前来源是 Temporal activity
  attempt

最小列：

- `attempt_id`
- `run_id`
- `step_id`
- `attempt`
- `worker_id`
- `task_queue`
- `workflow_id`
- `temporal_run_id`
- `activity_id`
- `activity_type`
- `activity_attempt`
- `status`
- `scheduled_at`
- `started_at`
- `completed_at`
- `schedule_to_start_ms`
- `duration_ms`
- `provider_request_ref`
- `provider_response_id`
- `model_provider`
- `model_name`
- `input_tokens`
- `output_tokens`
- `cached_input_tokens`
- `estimated_cost_microusd`
- `pricing_version`
- `cancel_outcome`
- `timeout_outcome`
- `terminal_reason`
- `failure_kind`
- `created_at`
- `updated_at`
- `metadata_json`

forward-required projection fields：

- `late_completion_outcome`
- `fail_close_reason`
- `replan_reason`

最小索引：

- primary key `(attempt_id)`
- unique `(run_id, step_id, attempt)`
- `(worker_id, status, started_at)`
- `(run_id, step_id, status)`
- `(run_id, step_id, attempt)`

`status` enum：

- `started`
- `running`
- `completed`
- `succeeded`
- `failed`
- `blocked`
- `canceled`
- `expired`

`cancel_outcome` enum：

- `not_requested`
- `requested_before_start`
- `activity_context_canceled`
- `cancel_delivered`
- `provider_connection_aborted`
- `provider_background_cancelled`
- `completed_before_cancel`
- `abort_unproven`

`timeout_outcome` enum：

- `not_timed_out`
- `activity_timeout`
- `activity_timeout`
- `provider_timeout`
- `workflow_timeout`

`late_completion_outcome` enum：

- `not_late`
- `ignored_after_cancel`
- `ignored_after_timeout`
- `ignored_after_terminal_projection`
- `accepted_before_terminal_projection`

规则：

- attempt 必须来自 Temporal activity task 或明确标记为本地 unit-test projection。
- retry 必须新建 attempt 并递增 `attempt` / `activity_attempt`
- failed attempt 不得原地改写成 succeeded
- `scheduled_at` / `started_at` / `completed_at`、`schedule_to_start_ms` 与
  `duration_ms` 是 operator latency 诊断主线；缺失值只能表示 activity metadata
  不可得，不得从 Temporal history 反查给 panel。
- provider-facing attempt 必须写 `provider_request_ref`、`provider_response_id`、
  `model_provider`、`model_name`、token usage、`estimated_cost_microusd` 与
  `pricing_version`。若 provider 已完成但 usage 缺失，result diagnostic 必须标记
  `provider_usage_missing`，不得静默写 0。
- admitted online provider model 必须存在 repo-owned pricing artifact；缺 pricing 是
  readiness / config failure，不是免费模型或 zero-cost fallback。
- cancel / timeout 只以 `cancel_outcome` / `timeout_outcome` 记录已证明的下游结果；
  无法证明 provider hard-abort 时必须写 `abort_unproven`。
- late completion 只能以 `late_completion_outcome` 记录 projection policy outcome；
  已 terminal run / step 不得被 late success 覆盖。
- `fail_close_reason` 表达 deterministic semantic / policy failure class；
  `replan_reason` 表达 bounded replan 的 admitted reason。二者都必须是 sanitized code，
  不保存 raw planner prompt 或 provider trace。
- metadata 不保存 raw prompt、raw provider response、raw source body、auth
  material 或 object store credential

## `runtime.agent_step_results`

用途：

- typed step terminal output truth

最小列：

- `result_id`
- `run_id`
- `step_id`
- `attempt_id`
- `result_kind`
- `visibility`
- `payload_schema_version`
- `payload_json`
- `payload_hash`
- `created_at`

最小索引：

- primary key `(result_id)`
- `(run_id, step_id)`
- `(attempt_id)`
- `(result_kind, created_at)`
- unique `(run_id, step_id, result_kind)` where result kind is terminal-singleton

`result_kind` enum：

- `typed_tool_result`
- `agent_output_projection`
- `retrieval_query_activity`
- `supporting_evidence`
- `grounding_verdict`
- `synthesis_draft_projection`
- `finalization_projection`

规则：

- payload 必须是 sanitized projection
- deterministic data access 输出 `typed_tool_result`
- semantic specialist 输出 `agent_output_projection`
- retrieval step 输出 `retrieval_query_activity` 与 supporting evidence projection
- synthesis / finalization 只能消费 admitted result，不得补造缺失 retrieval/tool result
- browser / Operator Console / eval 只能读取 projection 或 read model，不读取 raw
  provider trace

以上 raw payload 禁令限定于 durable runtime schema、metadata、operator projection 与
repo-owned product truth。受控 Langfuse/OpenAI LLM debug trace 可按
`docs/contracts/langfuse-runtime.md` 记录 raw 或 masked model IO，但不得反向写入这些
durable tables。

## `runtime.conversation_run_locks`

用途：

- conversation active primary run policy truth

最小列：

- `conversation_id`
- `active_run_id`
- `policy`
- `locked_at`
- `updated_at`

最小索引：

- primary key `(conversation_id)`
- unique `(active_run_id)`

`policy` enum：

- `reject_new_primary_run`
- `enqueue_after_active_run`
- `cancel_active_then_start`
- `interrupt_active_run`

规则：

- 第一版默认 `reject_new_primary_run`
- terminal run 必须释放 active lock
- stale lock 必须通过 run terminal / recovery audit 关闭，不能静默删除

## Operator Projection

operator-facing read model 不直接读取 scheduler internals。

允许投影：

- run status
- task queue
- queue wait duration
- Temporal task queue
- worker identity safe id
- terminal reason
- fail-close reason
- workflow mode
- selected tool
- source / evidence safe summary
- trace id / request id backlink
- step trajectory summary
- stage attribution：`routing`、`planning`、`tool`、`retrieval`、`rerank`、
  `selection`、`synthesis`、`grounding`
- step result safe refs

禁止投影：

- raw prompt
- raw provider response
- raw transcript
- raw auth material
- raw object-store path with credentials
- restricted source body

## Implementation Boundary

本文冻结 logical schema。当前 active serving path 使用 Temporal 作为 canonical execution
plane；step-level tables 是 product / Operator Console / eval projection truth，不能用
Temporal raw history、runtime event 字符串或 provider trace 代替。

实现必须遵守：

- schema first
- no fallback synthesis of missing run fields
- no dual-write silent success when durable run write fails
- no fallback synthesis of missing step / attempt / result fields
- no Redis-backed canonical queue
