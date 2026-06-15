---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Operator Schema

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

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
- `requested_scope_json` 用于展示调用方显式约束；`resolved_scope_json` 用于展示 agent 最终解析的
  serving scope
- `version_query_json` 用于展示 raw caller-supplied version query；operator surface
  如需友好文案应改读 `runtime.request_observability_fact.version_query_summary`
- 不从 `chat.messages` 反推生成
- 这层允许展示 app-layer 已物化的最小授权摘要，但不承担 canonical authz store，也不回放 provider/session
  原始材料
- `diagnostics_json` 只承载 panel 可直接消费的 summary-level explanation，不承载 retrieval
  internals

## `operator.request_audit_projection`

用途：

- panel `Audit` 域的 curated request-scoped timeline
- request observability detail 的 `auditSummary` 上游

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
- `requested_capability` nullable
- `selected_capability` nullable
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

- `audit_event_id` 默认与 `runtime.projection_outbox.event_id` 对齐，保证幂等 timeline 物化
- 这是 curated governance-safe audit projection，不是 raw JSONL replay
- `status` 表示该 audit event 自身的阶段语义；`terminal_code` 表示当前请求最终 terminal
  outcome，二者不得混写
- `diagnostics_json` 只保存受控最小摘要，例如
  `fail_closed`、`acl_anomaly_code`、`source_doc_ids`；当 event type 为
  `execution.*` 时，可以额外保存 lane、decision、failure kind、HTTP status、
  retryable、duration、queue wait 与 bridge duration
- 不保存 raw JWT、raw cookie、raw prompt、raw answer、raw retrieval payload 或 vendor
  sink blob

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
- authenticated notice collector run / replay batch / queue run 的 operator-safe
  status projection

最小列：

- `run_processing_id`
- `run_key`
- `source_channel`
- `source_surface`
- `site_id`
- `collector_run_token`
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

- `(collector_run_token, projected_at)`
- `(run_id, projected_at)`
- `(site_id, lifecycle_status, projected_at)`
- `(latest_queue_status, projected_at)`

规则：

- `run_processing_id` 是 run snapshot 幂等键，不是 queue row 的替代主键
- 这张表只服务 app-api operator list/detail；不改变 source-truth、queue、release 或
  downstream read-model truth
- run-level projection 只回答 collector run / replay batch / queue run 的整体状态，不承载
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
- `collector_run_token`
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
- `(collector_run_token, occurred_at)`

规则：

- `event_id` 可由 upstream event id 传入；缺省时由 run snapshot identity、stage、status、
  occurred time 与 ordinal 派生
- `payload_json` 只允许 compact reason code、count 与 typed status，不允许 raw logs、
  source file path、object-store locator、backup path、OCR/provider payload 或 raw stack
- event projection 只解释 run-level operator timeline，不作为 ingestion retry /
  cancellation command source

## `operator.metric_rollup`

用途：

- operator aggregate / timeseries read-model family
- 当前第一版支撑 `Overview` / `Quality` / `Safety` / `Cost` 中可由 app-owned rollup 提供的聚合面
- 当前已冻结的第一版 schema 已先落地 `Quality` timeseries bucket

最小列：

- `rollup_id`
- `request_id`
- `domain`
- `granularity`
- `bucket_start`
- `bucket_end`
- `surface`
- `selected_capability` nullable
- `requested_capability` nullable
- `principal_type`
- `collection` nullable
- `model_name` nullable
- `metrics_json`
- `projected_at`

最小索引：

- `(domain, granularity, bucket_start)`
- `(request_id, granularity, bucket_start)`
- `(domain, surface, bucket_start)`
- `(domain, selected_capability, bucket_start)`

规则：

- 这是 app-owned aggregate contribution family，不是不可逆 counter table
- projector 采用“每 request / 每 bucket / 每 granularity 一条可重算贡献行”的物化语义，允许按
  `request_id` 全量替换后重放
- `rollup_id` 必须包含 `request_id` 与 bucket/filter 维度，避免不同 request 落在同一 bucket
  时发生主键冲突
- 当前已冻结的第一版 schema 仅冻结 `domain=quality` 的 rollup shape
- `metrics_json` 只保存受控聚合贡献，不保存 raw request payload、raw sink blob 或 grader 原始结果
- 当前 feedback quality summary / timeseries 直接由 app-api query service 用
  `chat.message_feedback.request_id` join `runtime.request_observability_fact.request_id`
  得到；它不是 raw sink query，也暂不写入 `operator.metric_rollup.metrics_json`

## `operator.quality_badcase_projection`

用途：

- operator `Quality` 域的 app-owned badcase queue
- 当前已冻结的第一版 schema 支撑 `GET /api/operator/quality/badcases`

最小列：

- `badcase_id`
- `request_id`
- `trace_id`
- `surface`
- `selected_capability` nullable
- `status`
- `cause_class`
- `detected_by`
- `opened_at`
- `summary`
- `grade_json` nullable
- `projected_at`

最小索引：

- `(status, opened_at desc)`
- `(cause_class, opened_at desc)`
- `(detected_by, opened_at desc)`
- `(request_id, opened_at desc)`

规则：

- 这是 app-owned curated queue，不是 grader 原始输出表，也不是 sink issue 列表
- 当前已冻结的第一版 schema 仅由 runtime monitor 生成 badcase，`detected_by` 固定为
  `runtime_monitor`
- 当前已冻结的第一版 schema 已开放以下 app-owned runtime monitor
  `cause_class`：
  `citation_missing`、`empty_recall`、`grounding_failed`、
  `unsupported_by_evidence`、`policy_failed`、`authz_suspected` 与
  `freshness_fail_close`
- `badcase_id` 采用 request-scoped stable id，保证 projector 重放时幂等替换
- `grade_json` 为 sampled grading / 人工复核的后续回流保留；当前已冻结的第一版 schema 允许为 `null`
- `summary` 必须是 panel-safe 安全摘要，不得回放 raw prompt、raw answer、raw retrieval payload
- `GET /api/operator/quality/eval-candidates` 不新增独立表；它从
  `operator.quality_badcase_projection`、`operator.quality_grade_projection` 与
  `operator.trace_backlink_projection` 派生 operator-safe eval candidate intake，
  不写入 eval golden truth

## `operator.quality_grade_projection`

用途：

- operator `Quality` 域的 sampled grade read model
- `quality summary.sampledGrades`、`quality timeseries.sampledGroundingPassRate`
  与 `quality badcases.grade` 的 app-owned 上游

最小列：

- `grade_id`
- `request_id`
- `trace_id`
- `surface`
- `request_started_at`
- `selected_capability` nullable
- `requested_capability` nullable
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

- 这是 app-owned projection，不是 grader sink query cache
- `grade_id` 必须稳定地绑定 `request_id + grade_source + grade_domain`，保证重复回流时 upsert
  幂等
- `request_started_at` 保留 request window 对齐语义；aggregate query 不按 grader 到达时间反向定义
  request bucket
- 第一版 `grade_domain` 固定至少覆盖 `grounding`、`citation`、`policy`
- 第一版 `verdict` 固定至少允许 `pass`、`fail`、`needs_review`
- `score_milli` 只保存 panel 可展示的轻量分值；不保存 grader 原始 token-by-token 判断材料

## `operator.trace_backlink_projection`

用途：

- operator-facing request trace / issue deep link projection
- request observability detail、audit detail、quality badcase queue 的 `links.*` 上游

最小列：

- `request_id`
- `trace_id`
- `trace_link` nullable
- `issue_link` nullable
- `issue_fingerprint` nullable
- `projected_at`

最小索引：

- `(trace_id)`
- `(projected_at desc)`

规则：

- 这是 app-owned backlink projection，不是 raw sink event cache
- `request_id` 与 request-facing operator surfaces 一一对应
- deep link / fingerprint 可以来自 sink reconciliation 或 trace system，但必须先写入这里，panel
  不得直连 sink
- 不允许保存 raw trace payload、raw issue body、raw vendor event blob
