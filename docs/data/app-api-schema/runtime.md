---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Runtime Schema

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## `runtime.request_execution`

用途：

- command-side durable request truth

最小列：

- `request_id`
- `conversation_id`
- `user_message_id`
- `assistant_message_id` nullable
- `surface`
- `actor_user_id`
- `actor_principal_id`
- `actor_roles_json`
- `actor_departments_json`
- `principal_type`
- `principal_label` nullable
- `entitlement_snapshot_id` nullable
- `entitlement_groups_json`
- `visibility_scope` nullable
- `applicability_scope` nullable
- `idempotency_key` nullable
- `request_fingerprint_sha256` nullable
- `trace_id`
- `run_id` nullable
- `requested_capability` nullable
- `requested_scope_json` nullable
- `version_query_json` nullable
- `resolved_scope_json` nullable
- `selected_capability` nullable
- `status`
- `error_code` nullable
- `question_preview`
- `answer_preview` nullable
- `diagnostics_json` nullable
- `source_doc_ids_json` nullable
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `created_at`
- `updated_at`

最小索引：

- `(conversation_id, started_at desc)`
- `(status, started_at desc)`
- `(run_id, started_at desc)`
- unique `(actor_user_id, idempotency_key)` where `idempotency_key is not null`

`status` 第一版允许：

- `accepted`
- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`
- `cancelled`

规则：

- 这是 panel request truth 的上游 command-side owner
- 首轮 lazy-create 请求在分配 canonical conversation id 之前，允许用稳定的 new-conversation
  discriminator 参与 `request_fingerprint_sha256` 计算
- `question_preview` / `answer_preview` 是 projection-friendly 摘要，不要求保存 raw full
  prompt / raw full answer
- `principal_type` / `principal_label` 是 command-side 落盘后的最小 operator projection
  metadata；不要再把 raw auth/session snapshot 宽 JSON 写入这里
- `entitlement_snapshot_id` / `entitlement_groups_json` / `visibility_scope` /
  `applicability_scope` 只保存 app-layer 已收口的最小授权摘要，用于 request projection 与
  operator-facing restricted request diagnostics；不要把 raw provider claims、raw
  cookie、raw session 或宽 auth snapshot 落进这里
- `requested_scope_json` 与 `source_doc_ids_json` 使用结构化 JSON，不把 Python-side
  payload 原样塞进宽 JSON dump
- `requested_scope_json` 表示 accept 时上游显式请求的 scope，可为空
- `version_query_json` 保存 raw caller-supplied version query；缺失表示 caller 没有显式覆盖
  current
- `resolved_scope_json` 表示 finalized execution 实际命中的 serving scope；如果 agent
  自主解析 surface，这里必须落最终解析结果
- `selected_capability` 表示 finalized execution 实际选择的 capability id；它不承载
  forward family vocabulary，也不应被重载为 operator-facing display label
- `run_id` 是 durable agent runtime 的 answer execution backlink；cutover 前旧同步执行
  路径可以为空，durable chat 主路径必须在第一次 command-side commit 后显式绑定真实
  durable `Run`
- `diagnostics_json` 只保存 operator-facing summary diagnostics，例如 resolved policy
  object、rewritten query、clarification/no-answer reason 与 retrieved title
  summary；不要写 raw evidence snippet、score 或 backend payload
- `rejected` 覆盖两类显式 fail-close：
  - execution policy reject
  - app-api precheck reject，例如 future `Phase I` throttle 命中后的
    `error_code=rate_limit_exceeded`
- 因此 `rate_limit_exceeded` 不新增新的 request status；它固定表现为 `status=rejected`
- `cancelled` 表示 execution 已接受 explicit cancel 或 upstream cancel 并停止等待；它不是
  semantic answer failure

## `runtime.projection_outbox`

用途：

- command-side 已提交事实到 read-model projector 的边界

最小列：

- `event_id`
- `request_id`
- `event_type`
- `payload_json`
- `occurred_at`
- `available_at`
- `processed_at` nullable
- `attempt_count`
- `last_error` nullable

最小索引：

- `(processed_at, available_at)`
- `(request_id, occurred_at desc)`

第一版 `event_type` 至少允许：

- `request.accepted`
- `request.completed`
- `request.needs_clarification`
- `request.no_answer`
- `request.error`
- `request.approval_required`
- `request.rejected`
- `request.cancelled`
- `execution.admission_rejected`
- `execution.cancel_requested`
- `execution.cancelled`
- `execution.runtime_failed`
- `execution.timed_out`

规则：

- projector 必须按 `event_id` 做幂等消费
- outbox payload 只携带 projection 所需字段，不承担 raw audit dump 角色
- `execution.*` payload 只允许 Go `apps/execution-control` 的 safe runtime summary，例如
  lane、decision、failure kind、HTTP status、retryable、duration 与 queue wait；禁止
  raw prompt、raw answer、raw transcript、auth material、
  retrieval payload 或 provider raw response

## `runtime.request_observability_fact`

用途：

- request-scoped operator observability foundation

最小列：

- `request_id`
- `trace_id`
- `conversation_id`
- `surface`
- `principal_type`
- `entitlement_snapshot_id` nullable
- `policy_projection_version` nullable
- `policy_reason` nullable
- `requested_capability` nullable
- `requested_scope_summary` nullable
- `version_query_mode` nullable
- `version_query_summary` nullable
- `resolved_scope_summary` nullable
- `collection` nullable
- `selected_capability` nullable
- `status`
- `error_code` nullable
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `retrieval_attempted` nullable
- `candidate_count` nullable
- `retrieved_source_count` nullable
- `retrieved_sources_json` not null default `[]`
- `supporting_sources_json` not null default `[]`
- `empty_recall` nullable
- `citation_expected` nullable
- `citation_count` nullable
- `citation_missing` nullable
- `refusal_class` nullable
- `semantic_outcome` nullable
- `scope_class` nullable
- `acl_decision` nullable
- `acl_anomaly_code` nullable
- `fail_closed` nullable
- `model_provider` nullable
- `model_name` nullable
- `prompt_id` nullable
- `prompt_version` nullable
- `template_sha256` nullable
- `model_execution_state` nullable
- `model_execution_detail` nullable
- `input_tokens` nullable
- `output_tokens` nullable
- `cached_input_tokens` nullable
- `estimated_cost_microusd` nullable
- `retrieval_adequacy_verdict` nullable
- `retrieval_adequacy_reason` nullable
- `claim_support_summary_json` nullable
- `trace_available`
- `projection_lag_ms` nullable
- `measured_at`
- `updated_at`

最小索引：

- `(started_at desc)`
- `(status, started_at desc)`
- `(surface, started_at desc)`
- `(selected_capability, started_at desc)`
- `(principal_type, started_at desc)`
- `(model_name, started_at desc)`
- `(collection, started_at desc)`

规则：

- `request_id` 与 `runtime.request_execution.request_id` 一一对应
- `accepted` 阶段必须先 seed 这张表；`finalized` 阶段必须 upsert typed execution outcome
- `accepted` 阶段的 `resolved_scope_summary` 与 `collection` 必须保持 `null`
- `finalized` 阶段的 `collection` 必须按 `resolved_scope_summary` 对应的最终 collection
  回填，不能继续拿 `requested_scope_summary` 充当真实执行 collection
- `selected_capability` 继续只保存 raw capability id，供 operator projection /
  aggregate 过滤；future family grouping 如有需要，应走显式新字段或 projection
- `version_query_mode` / `version_query_summary` 只保存 operator-safe 版本查询摘要，不回放
  raw caller payload
- `retrieval_adequacy_verdict` / `retrieval_adequacy_reason` 表示 retrieval base
  是否足以支撑回答；它们与 `grounding` 结果不是同一维度
- `retrieved_sources_json` 保存 bounded raw retrieval candidate
  trace；`supporting_sources_json` 保存最终 answer-facing support trace
- 两列都只允许保存 operator-safe compact identity fields，不保存 raw snippet、raw provider
  citation blob 或 vendor payload
- `supporting_sources_json` 必须允许同时表达 canonical source identity 与 physical
  projection-unit identity，例如 `canonical_source_id` / `source_unit_key`
- `claim_support_summary_json` 只保存 operator-safe 聚合摘要，不保存 raw
  `claim_supports`、support snippet 或 provider-native citation/support blob
- `projection materialization` 负责更新 `projection_lag_ms`、`measured_at` 与
  projection health summary，不回写 `runtime.request_execution`
- 这是 app-owned summary fact family，不保存 raw prompt、raw answer、raw transcript、raw
  retrieval payload、raw auth material
- prompt 相关列只保存 observability-safe identity 与 typed runtime state，不保存 raw prompt
  或 provider refusal 文本
- token / model / cost 字段只能来自 execution-side typed telemetry seam，不从 panel 或
  sink query 反推
- panel 和 aggregate APIs 只能读 app-owned projection/fact family，不得直连 `Sentry` /
  `Axiom` 原始 sink
