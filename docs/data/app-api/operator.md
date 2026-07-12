---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-11
---

# App API Operator Schema

<!-- markdownlint-disable MD013 -->

## Document Boundary

This document owns app-api operator read-model logical schema. It does not own
Operator Console product UX, raw observability sinks, request lifecycle command
truth or release closeout.

## `operator.request_projection`

用途：

- panel `Requests` 的 canonical read model

最小列：

- `request_id`
- `trace_id`
- `surface`
- `conversation_id`
- `principal_type`
- `principal_id`
- `principal_label` nullable
- `entitlement_snapshot_id` nullable
- `entitlement_groups_json`
- `visibility_scope` nullable
- `applicability_scope` nullable
- `requested_tool` nullable
- `requested_scope` nullable
- `version_query_json` nullable
- `resolved_scope` nullable
- `selected_tool` nullable
- `status`
- `error_code` nullable
- `question_preview`
- `answer_preview` nullable
- `source_doc_ids_json`
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `projected_at`

最小索引：

- `(started_at desc)`
- `(status, started_at desc)`
- `(conversation_id, started_at desc)`

规则：

- `request_id` 与 `runtime.request_execution.request_id` 一一对应
- 这是 panel-facing materialized view，不要求与 command-side 列完全相同
- `requested_scope` 用于展示 trusted internal caller 显式约束；`resolved_scope` 用于展示
  execution-control 最终准入的 model-facing scope id
- `version_query_json` 用于展示已规范化的 caller version query；operator surface
  如需友好文案应改读 `runtime.request_observability_fact.version_query_summary`
- 不从 `chat.messages` 反推生成
- 这层允许展示 app-layer 已物化的最小授权摘要，但不承担 canonical authz store，也不回放 provider/session
  原始材料

## `operator.request_audit_projection`

用途：

- current-code residue for the old standalone Audit/request-detail timeline
- not part of the target Ops Index architecture

最小列：

- `audit_event_id`
- `request_id`
- `trace_id`
- `occurred_at`
- `event_type`
- `surface`
- `principal_type`
- `entitlement_snapshot_id` nullable
- `policy_projection_version` nullable
- `requested_tool` nullable
- `selected_tool` nullable
- `status`
- `terminal_code` nullable
- `summary`
- `diagnostics_json`
- `projected_at`

最小索引：

- `(request_id, occurred_at desc)`
- `(trace_id, occurred_at desc)`
- `(event_type, occurred_at desc)`
- `(status, occurred_at desc)`

规则：

- 该表不再作为目标态数据模型扩展；后续代码清理应优先移除或收窄它
- `audit_event_id` 默认与 `runtime.projection_outbox.event_id` 对齐，保证幂等 timeline 物化
- 这是 curated governance-safe audit projection，不是 raw JSONL replay
- `status` 表示该 audit event 自身的阶段语义；`terminal_code` 表示当前请求最终 terminal
  outcome，二者不得混写
- `diagnostics_json` 只保存受控最小摘要，例如
  `fail_closed`、`acl_anomaly_code`、`source_doc_ids`；当 event type 为
  `execution.*` 时，可以额外保存 lane、decision、failure kind、HTTP status、
  retryable、duration、queue wait 与 activity duration
- 不保存 raw JWT、raw cookie、raw prompt、raw answer、raw retrieval payload、query
  rewrite text、retrieval query text、source snippet 或 vendor sink blob

## `operator.authenticated_notice_processing_projection`

用途：

- Operator Console `通知处理` 的 canonical read model
- authenticated notice queue / downstream materialization 的 operator-safe status
  projection

最小列：

- `processing_id`
- `notice_key`
- `source_channel`
- `source_surface`
- `site_id`
- `notice_id`
- `title`
- `run_id` nullable
- `job_id` nullable
- `replay_batch_id` nullable
- `enqueue_source` nullable
- `queue_status`
- `lifecycle_status`
- `latest_stage`
- `target_surface` nullable
- `candidate_kind` nullable
- `materialization_status` nullable
- `release_id` nullable
- `current`
- `tool_ready`
- `read_model_counts_json`
- `child_task_summary_json`
- `timeline_json`
- `downstream_json` nullable
- `last_error_code` nullable
- `last_error_message` nullable
- `attempt_count`
- `last_observed_at`
- `source_updated_at` nullable
- `projected_at`
- `producer_version`
- `redaction_version`

最小索引：

- `(notice_id, projected_at)`
- `(notice_key, projected_at)`
- `(lifecycle_status, projected_at)`
- `(target_surface, candidate_kind, projected_at)`
- `(run_id, projected_at)`

规则：

- `processing_id` 是 snapshot 幂等键，不是 queue row 的替代主键
- 这张表只服务 app-api operator list/detail；不改变 source-truth、queue、release 或
  downstream read-model truth
- detail effective record 排序固定优先 `tool_ready=true`、`current=true`、
  `projected_at desc`
- `read_model_counts_json` 只能保存 operator-safe aggregate counts，例如
  `scheduledDepartures`、`rejectedSources`、`snapshots` 与 `currentSnapshots`
- `timeline_json` 与 `downstream_json` 只能保存 sanitized summaries；不得保存 raw
  notice body、HTML、OCR text/table、attachment bytes、object-store key、local path、
  credential 或 raw stack trace
- `timeline_json.payload` 允许保存 compact operator evidence，例如
  `reasonCode`、`regulationAdmissionClass`、`promotionDisposition`、
  `applicabilityStatus`、`targetCollection`、`auditRunId`、`cleanupRunId`、
  `cleanupDisposition`、`postgresExactRemaining`、
  `objectStoreExactKeysRemaining` 与 `qdrantResidueCount`
- `timeline_json.payload` 禁止保存 bucket、object key、backup path、artifact path、raw
  operations path 或任何可反向定位 source/derived object 的字段
- first release 是 read-only projection；retry、cancel、re-enqueue 不是这张表或 panel
  surface 的职责

## `operator.authenticated_notice_processing_event_projection`

用途：

- authenticated notice processing detail timeline 的 idempotent event projection
- 后续 freshness / reconciliation diagnostics 的 operator-safe event source

最小列：

- `event_id`
- `processing_id`
- `notice_key`
- `notice_id`
- `run_id` nullable
- `job_id` nullable
- `stage`
- `status`
- `occurred_at`
- `summary`
- `payload_json`
- `projected_at`

最小索引：

- `(processing_id, occurred_at)`
- `(notice_id, occurred_at)`

规则：

- `event_id` 可由 upstream event id 传入；缺省时由 snapshot identity、stage、status、
  occurred time 与 ordinal 派生
- `payload_json` 只允许 compact reason code、count、typed status 或 audit/cleanup run
  id，不允许 raw logs、source file path、object-store locator、backup path 或
  OCR/provider payload
- event projection 只解释 operator timeline，不作为 ingestion retry / cancellation
  command source

## `operator.authenticated_notice_run_processing_projection`

用途：

- Operator Console `通知 run 处理` 的 canonical read model
- internal portal source source run / replay batch / queue run 的 operator-safe
  status projection

最小列：

- `run_processing_id`
- `run_key`
- `source_channel`
- `source_surface`
- `site_id`
- `source_run_token`
- `run_id`
- `replay_batch_id` nullable
- `enqueue_source` nullable
- `lifecycle_status`
- `latest_stage`
- `latest_queue_status`
- `queue_job_count`
- `queue_status_counts_json`
- `attempt_count`
- `source_truth_json`
- `child_task_summary_json`
- `downstream_json`
- `job_summaries_json`
- `timeline_json`
- `last_error_code` nullable
- `last_error_message` nullable
- `first_observed_at`
- `last_observed_at`
- `projected_at`
- `producer_version`
- `redaction_version`

最小索引：

- `(source_run_token, projected_at)`
- `(run_id, projected_at)`
- `(site_id, lifecycle_status, projected_at)`
- `(latest_queue_status, projected_at)`

规则：

- `run_processing_id` 是 run snapshot 幂等键，不是 queue row 的替代主键
- 这张表只服务 app-api operator list/detail；不改变 source-truth、queue、release 或
  downstream read-model truth
- run-level projection 只回答 source run / replay batch / queue run 的整体状态，不承载
  单个 notice 的 effective processing 详情
- `source_truth_json` 可保存 `selectedNoticeCount`、`importedNoticeCount`、
  `attachmentFetchStatusRecordCount`、`rawUploadedCount`、`rawReusedCount` 与少量 title/id
  samples；不得保存 raw source object refs
- `downstream_json` 可保存 candidate kind、target surface、materialized release
  count 与 status summary；source-truth-only run 可显示 `skipped_source_truth_only`
- `job_summaries_json` 只保存 job id、run id、queue status、attempt count、selected/imported
  count、updated timestamp 与 normalized error 信息
- first release 是 read-only projection；retry、cancel、re-enqueue 不是这张表或 panel
  surface 的职责

## `operator.authenticated_notice_run_processing_event_projection`

用途：

- authenticated notice run-processing detail timeline 的 idempotent event projection
- 后续 run-level freshness / reconciliation diagnostics 的 operator-safe event source

最小列：

- `event_id`
- `run_processing_id`
- `run_key`
- `source_run_token`
- `run_id`
- `job_id` nullable
- `stage`
- `status`
- `occurred_at`
- `summary`
- `payload_json`
- `projected_at`

最小索引：

- `(run_processing_id, occurred_at)`
- `(source_run_token, occurred_at)`

规则：

- `event_id` 可由 upstream event id 传入；缺省时由 run snapshot identity、stage、status、
  occurred time 与 ordinal 派生
- `payload_json` 只允许 compact reason code、count 与 typed status，不允许 raw logs、
  source file path、object-store locator、backup path、OCR/provider payload 或 raw stack
- event projection 只解释 run-level operator timeline，不作为 ingestion retry /
  cancellation command source

## `operator.quality_grade_projection`

用途：

- current-code residue for old app-api-owned sampled grade projection
- not part of the target Ops Index architecture; Langfuse owns score/platform
  workflow, while repo fixtures own canonical eval truth

最小列：

- `grade_id`
- `request_id`
- `trace_id`
- `surface`
- `request_started_at`
- `selected_tool` nullable
- `requested_tool` nullable
- `principal_type`
- `collection` nullable
- `model_name` nullable
- `grade_source`
- `grade_domain`
- `verdict`
- `score_milli` nullable
- `grader_version`
- `rationale_summary` nullable
- `sampled_at`
- `projected_at`

最小索引：

- `(request_id, grade_domain)`
- `(grade_domain, request_started_at desc)`
- `(grade_domain, surface, request_started_at desc)`
- `(grade_source, sampled_at desc)`

规则：

- 该表不再作为目标态数据模型扩展；不得以它为理由恢复 online quality dashboard
- 这是 app-owned projection，不是 grader sink query cache
- `grade_id` 必须稳定地绑定 `request_id + grade_source + grade_domain`，保证重复回流时 upsert
  幂等
- `request_started_at` 保留 request window 对齐语义；aggregate query 不按 grader 到达时间反向定义
  request bucket
- 第一版 `grade_domain` 固定至少覆盖 `grounding`、`citation`、`policy`
- 第一版 `verdict` 固定至少允许 `pass`、`fail`、`needs_review`
- `score_milli` 只保存 panel 可展示的轻量分值；不保存 grader 原始 token-by-token 判断材料
