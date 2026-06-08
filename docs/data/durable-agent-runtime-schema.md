---
doc_type: data
status: active
created: 2026-06-04
updated: 2026-06-08
---
# Durable Agent Runtime Schema

## 文档边界

本文冻结 run-centric durable agent runtime 的 product / projection 逻辑数据模型。

它回答的是：

- 哪些 logical tables / records 拥有 product runtime projection truth
- conversation、run、step、attempt、result、event 如何关联
- historical PG lease / lane budget / worker heartbeat artifact 如何被隔离
- 哪些字段是 canonical truth，哪些只是 projection / correlation

它不负责：

- 具体 migration 文件名
- 物理分库 / 分区策略
- SQL DDL 的完整列类型和索引语法
- 当前代码是否已实现这些表
- Temporal internal workflow history schema

稳定 contract 见：

- `docs/contracts/durable-agent-runtime-contract.md`

## Logical Schema Namespace

第一版逻辑 schema 固定使用：

`runtime.*`

原因：

- app-api 已拥有 `runtime.request_execution` 与 `runtime.projection_outbox`
- run projection 是 product/runtime projection truth，不属于 `chat.*`
- worker lease 与 scheduler truth 已由 Temporal Task Queue / Activity policy 承接；
  PG lease rows 只保留为 historical migration artifact

## Table Overview

active product projection tables：

- `runtime.agent_runs`
- `runtime.agent_run_steps`
- `runtime.agent_step_attempts`
- `runtime.agent_step_results`
- `runtime.agent_run_events`
- `runtime.conversation_run_locks`

historical PG lease artifact tables：

- retired execution lease table
- retired lane budget table
- retired worker heartbeat table

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

retired PG baseline queue 曾由 PG durable rows 表达；这些行现在只属于 historical
artifact，不是当前 online serving truth，不得被重新作为 fallback 接回 app-api /
execution-control：

- run-level queue：`runtime.agent_runs.status='queued'`
- step-level queue：`runtime.agent_run_steps.status='queued'`

retired baseline 消费规则：

- scheduler 使用 `FOR UPDATE SKIP LOCKED` 读取候选 queued rows
- scheduler 在同一事务中检查 lane budget、worker readiness、dependency state 与 downstream
  budget，并写入 retired execution lease table
- worker 只消费 active lease，不直接扫描 queued rows 自行执行
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
- `requested_capability`
- `selected_capability`
- `lane`
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
- `(status, lane, created_at)`
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
- `owner_user_id` 是 app-api 投影后的 principal id，不从 supervisor header 反推
- `metadata_json` 不保存 raw prompt、raw answer、provider raw response、auth
  material 或 restricted raw body
- `metadata_json.execution_payload` 是 app-api 提供给 supervisor 的执行投影；它必须
  与外层 `request_id`、`conversation_id` 和非空 `trace_id` 对齐，且必须包含非空
  `user_goal`
- `metadata_json` 不允许由 app-api 写入 agent `handoff`；handoff planning 属于
  supervisor execution control plane

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

最小列：

- `step_id`
- `run_id`
- `parent_step_id`
- `dependency_step_ids_json`
- `lane`
- `capability_family`
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
- `(lane, status, created_at)`
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

- worker 对某个 step 的 attempt projection truth；target architecture 中来源是 Temporal
  activity attempt；PG execution lease attempt 只属于 historical baseline

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
- `bridge_cancel_delivered`
- `provider_connection_aborted`
- `provider_background_cancelled`
- `completed_before_cancel`
- `abort_unproven`

`timeout_outcome` enum：

- `not_timed_out`
- `activity_timeout`
- `bridge_timeout`
- `provider_timeout`
- `workflow_timeout`

规则：

- attempt 必须来自 Temporal activity task 或明确标记为本地 unit-test projection；active
  serving 不引用 PG lease。
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
- browser / panel / eval 只能读取 projection 或 read model，不读取 raw provider trace

## Retired PG Execution Lease Table

用途：

- historical PG baseline durable execution lease artifact

target architecture 中 Temporal task queue / activity heartbeat / timeout 替代
execution lease 作为 canonical dispatch substrate；本表只保留为 migration artifact，不参与
online serving。

最小列：

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
- `created_at`
- `updated_at`

最小索引：

- primary key `(lease_id)`
- `(run_id, step_id, attempt)`
- `(lane, status, expires_at)`
- `(worker_id, status)`
- partial unique active lease by `(run_id, step_id)`

`status` enum：

- `available`
- `leased`
- `released`
- `expired`
- `revoked`

历史规则：

- retired PG worker 只有持有 `leased` 且未过期的 lease 才能执行
- lease heartbeat 必须更新 `heartbeat_at` 与可选 `expires_at`
- lease expiry 由 scheduler 判断并写 terminal event / retry event；未达到显式
  retry 上限时，同一 run 可以回到 `queued`，下一条 lease 必须写递增后的
  `attempt`
- release 必须写 `release_reason`
- run-level single-step execution 也必须使用 canonical root `step_id`，不能让
  `execution_leases.step_id` 永久为空

## `runtime.lane_budgets`

用途：

- historical PG baseline lane-level budget artifact

target architecture 中 worker budget 与扩缩容决策来自 Temporal task queue metrics、
downstream budget projection 与 operations-plane policy。本表不参与 online serving
scheduler，不拥有当前 execution truth。

最小列：

- `lane`
- `max_active_leases`
- `max_queued_runs`
- `queue_timeout_ms`
- `run_timeout_ms`
- `lease_timeout_ms`
- `worker_heartbeat_timeout_ms`
- `enabled`
- `updated_at`

最小索引：

- primary key `(lane)`

规则：

- lane enum 第一版固定为 `rag`、`notice`、`navigation`、`campus_services`、`default`
- disabled historical lane 不允许创建新 execution lease
- lane budget 不替代 user / org / conversation budget

## `runtime.worker_heartbeats`

用途：

- historical PG baseline worker readiness / lease ownership observation

最小列：

- `worker_id`
- `worker_kind`
- `lanes_json`
- `runtime_version`
- `status`
- `heartbeat_at`
- `started_at`
- `metadata_json`

最小索引：

- primary key `(worker_id)`
- `(status, heartbeat_at desc)`

历史规则：

- heartbeat 只证明 historical PG worker liveness，不证明 run success
- historical scheduler 可以拒绝 stale worker 获取新 lease
- metadata 不保存 secrets、raw prompt、provider payload 或 object-store credentials

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
- lane
- queue wait duration
- Temporal task queue
- worker identity safe id
- terminal reason
- fail-close reason
- workflow mode
- selected capability
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

## Migration Boundary

本文冻结 logical schema。当前 active serving path 使用 Temporal 作为 canonical execution
plane；PG-backed run-level durable baseline 仅保留为 historical migration artifact。
step-level tables 是 product / panel / eval projection truth，不能用
Temporal raw history、runtime event 字符串或 provider trace 代替。

实现必须遵守：

- schema first
- migration tests before runtime cutover
- no fallback synthesis of missing run fields
- no dual-write silent success when durable run write fails
- no fallback synthesis of missing step / attempt / result fields
- no Redis-backed canonical queue
