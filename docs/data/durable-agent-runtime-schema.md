---
doc_type: data
status: active
created: 2026-06-04
updated: 2026-06-04
---
# Durable Agent Runtime Schema

## 文档边界

本文冻结 run-centric durable agent runtime 的逻辑数据模型。

它回答的是：

- 哪些 logical tables / records 拥有 durable runtime truth
- conversation、run、event、lease、lane budget、worker heartbeat 如何关联
- 哪些字段是 canonical truth，哪些只是 projection / correlation

它不负责：

- 具体 migration 文件名
- 物理分库 / 分区策略
- SQL DDL 的完整列类型和索引语法
- 当前代码是否已实现这些表

稳定 contract 见：

- `docs/contracts/durable-agent-runtime-contract.md`

## Logical Schema Namespace

第一版逻辑 schema 固定使用：

`runtime.*`

原因：

- app-api 已拥有 `runtime.request_execution` 与 `runtime.projection_outbox`
- durable run 是 product/runtime execution truth，不属于 `chat.*`
- worker lease 与 scheduler truth 属于 runtime，而不是 `operator.*` read model

## Table Overview

目标 logical tables：

- `runtime.agent_runs`
- `runtime.agent_run_events`
- `runtime.execution_leases`
- `runtime.lane_budgets`
- `runtime.worker_heartbeats`
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

## `runtime.agent_runs`

用途：

- answer-level durable run truth

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

## `runtime.execution_leases`

用途：

- durable execution lease truth

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

规则：

- worker 只有持有 `leased` 且未过期的 lease 才能执行
- lease heartbeat 必须更新 `heartbeat_at` 与可选 `expires_at`
- lease expiry 由 scheduler 判断并写 terminal event / retry event；未达到显式
  retry 上限时，同一 run 可以回到 `queued`，下一条 lease 必须写递增后的
  `attempt`
- release 必须写 `release_reason`

## `runtime.lane_budgets`

用途：

- durable lane-level budget truth

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
- disabled lane 不允许创建新 execution lease
- lane budget 不替代 user / org / conversation budget

## `runtime.worker_heartbeats`

用途：

- worker readiness / lease ownership observation

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

规则：

- heartbeat 只证明 worker liveness，不证明 run success
- scheduler 可以拒绝 stale worker 获取新 lease
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
- lease owner safe id
- terminal reason
- fail-close reason
- workflow mode
- selected capability
- source / evidence safe summary
- trace id / request id backlink

禁止投影：

- raw prompt
- raw provider response
- raw transcript
- raw auth material
- raw object-store path with credentials
- restricted source body

## Migration Boundary

Phase 1 冻结 logical schema。

Phase 3 foundation 已在 `apps/supervisor-api/internal/execution` 中提供
Postgres-backed durable runtime store 与 schema bootstrap；它用于验证 durable runtime
tables、indexes 与 store contract，不表示 current chat execution 已切换到 durable
scheduler。

后续 implementation 必须遵守：

- schema first
- migration tests before runtime cutover
- old `runtime.request_execution` remains current request projection truth until
  run creation endpoint is implemented
- no fallback synthesis of missing run fields
- no dual-write silent success when durable run write fails
