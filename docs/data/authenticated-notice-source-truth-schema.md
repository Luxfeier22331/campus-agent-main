---
doc_type: data
status: active
created: 2026-04-03
updated: 2026-04-30
---
# Authenticated Notice Source-Truth Schema

## 文档边界

本文冻结 `authenticated_notice_portal` source channel 的 canonical source-truth
schema。

当前作用域只覆盖 `notice` surface，不覆盖同一 portal 下的 `file_release` surface。`file_release`
当前仍停留在 collector-owned typed export / source capture 阶段，不能反向改写本文的 notice
source-truth schema。

`file_release` 当前 export contract 另见：

- `docs/reference/authenticated-notice-file-release-export-contract.md`

它回答的是：

- notice source 在 `capture/`、`provider/`、`source-truth/` 三层分别保留什么
- notice source-truth 的 notice-level、block-level 与 attachment-ref-level
  canonical 字段是什么
- 哪些字段属于 source-truth，哪些字段明确不属于
- 登录态 notice source-truth 如何与下游 document/chunk/restricted serving 解耦

它不负责：

- 具体登录方式或认证刷新策略
- collector 调度与 run lifecycle admission
- 某个 collection 的 cleanup / chunking / retrieval 策略
- entitlement policy 的最终解释

对应文档：

- source-channel
  运行边界：`docs/architecture/domains/authenticated-notice/architecture.md`
- `file_release` collector-owned export
  contract：`docs/reference/authenticated-notice-file-release-export-contract.md`
- shared replay / rebuild
  boundary：`docs/architecture/system/data-plane-architecture.md`
- `internal_notice` collection-specific offline preparation
  strategy：`docs/reference/internal-notice-offline-preparation-strategy.md`
- restricted document center artifact
  contract：`docs/reference/restricted-document-center-artifact-contract.md`
- restricted
  rollout：`docs/architecture/system/identity-and-authorization-architecture.md`

## 目标

登录态 notice source-truth 的目标是把“门户内一条稳定 notice 资源”的正文、分类、链接和附件关系吸收成可 replay、可
fan-out、可审计的 canonical upstream，而不是让下游长期依赖 collector 自己的 SQLite/export shape。

## 核心结论

- source-truth unit 固定为稳定的 `notice` 资源，而不是某次采集 run 或某次 API 请求实例
- source-truth 必须同时保留 notice identity、fetch provenance、正文 block truth 与
  attachment refs
- source-truth 可以服务多个下游 collection / corpus，但不得提前携带 document、chunk、retrieval 或
  serving 语义
- 一旦 canonical notice source-truth 存在，后续 replay / rebuild 必须从 source-truth
  开始，而不是返回 bootstrap export 或 collector DB

## Canonical 形态

`capture artifacts -> provider artifacts -> notice source-truth -> declared
projections -> canonical document artifacts -> document-units -> chunks ->
index`

补充说明：

- 本文中的 source-truth schema 只冻结 `capture/`、`provider/`、`source-truth/` 三层
  source-owned artifacts
- 如果后续有持久化 source-side projection artifact，它们落在同一 source prefix 下的 sibling
  `projection/<projection_name>/...`，但不属于本文的 source-truth schema 本体

## Artifact 分层

### Capture Layer

`capture/` 保存 collector 直接观测到的 notice 级输入。

长期 canonical artifacts 固定为：

- `capture/list-response.json`
- `capture/detail-response.json`
- `capture/fetch-metadata.json`

说明：

- `list-response.json` 保存 notice 来自 list/query surface 的原始观测
- `detail-response.json` 保存 notice detail 正文与附件清单的原始观测
- `fetch-metadata.json` 保存采集时间、collector/runtime 版本、source-specific fetch facts

### Provider Layer

`provider/` 保存 source-specific normalize 输出，供排障、升级 normalize 逻辑与重建 source-truth
使用。

长期 canonical artifacts 固定为：

- `provider/normalized-notice.json`
- `provider/discovered-links.jsonl`
- `provider/attachment-observations.jsonl`

说明：

- `normalized-notice.json` 可以包含 collector 侧 notice metadata、HTML normalize、分类聚合与
  source-specific flags
- `discovered-links.jsonl` 保存正文与 notice-level link 观测
- `attachment-observations.jsonl` 保存附件与正文资源观测
- provider artifacts 不得直接成为下游 collection 的长期 contract

### Source-Truth Layer

`source-truth/` 保存 parser-agnostic canonical upstream。

长期 canonical artifacts 固定为：

- `source-truth/notice-manifest.json`
- `source-truth/content-blocks.jsonl`
- `source-truth/attachment-refs.jsonl`

说明：

- `notice-manifest.json` 保存 notice 级 identity、metadata、fetch provenance 与整体摘要
- `content-blocks.jsonl` 保存正文块级内容与结构真相
- `attachment-refs.jsonl` 保存 notice 对附件或正文资源的稳定引用关系

## Source Asset Identity

notice source asset 的 identity 固定为“稳定 notice 资源”，而不是某次 run 中的一条暂态记录。

### `raw_asset_id`

`raw_asset_id` 必须稳定表达同一条 notice，推荐由以下信息派生：

- `site_id`
- `notice_id`

### `raw_version_id`

`raw_version_id` 表达同一条 notice 的内容版本。

它只应在以下内容发生实质变化时推进：

- 标题变化
- 正文 HTML 或 canonical block 内容变化
- notice 分类集合变化
- 附件引用集合变化

以下变化单独不足以推进新 `raw_version_id`：

- 仅采集时间不同
- 仅 collector 运行元数据不同
- 仅本地缓存路径不同
- 仅瞬时错误重试或日志字段不同

## Incremental Sync Contract

authenticated notice 采集必须把“增量游标”和“内容版本”分开治理：

- list/detail fetch 的游标只决定下一轮 collector 从哪里继续观察
- `raw_asset_id` / `raw_version_id` 决定 source-truth 是否产生新版本
- attachment / inline image / file-release relation 的成功、404、reference-only、
  unsupported、pending multimodal 等结果必须作为 typed outcome 记录，而不是靠重复报错表达
- portal 下载端点返回稳定 404 时，应保留 source relation 与 terminal fetch status，用于后续
  audit / owner recovery；不得无限重复下载同一失败资源
- full-scope replay 只允许作为显式 operator operation；日常运行应按 cursor / selected
  notice ids / changed raw version 进入 source-truth rebuild

这条 contract 不改变 source-truth schema 的对象存储布局；它补充的是持续 ingest 的幂等、
去重和失败终态语义。

## Notice Manifest Canonical 字段

`notice-manifest.json` 至少固定以下字段组。

### A. Source Identity

- `schema_version`
- `source_channel`
- `site_id`
- `notice_id`
- `raw_asset_id`
- `raw_version_id`

### B. Fetch Provenance

- `captured_at`
- `list_observed_at`
- `detail_observed_at`
- `fetcher_name`
- `fetcher_version`
- `collector_version`
- `credentials_mode`

`credentials_mode` 第一版允许：

- `authenticated`

### C. Notice Metadata

- `notice_title_raw`
- `notice_title_normalized`
- `organization_name`
- `organization_id`
- `notice_release_time`
- `notice_create_time`
- `notice_first_time`
- `notice_source`
- `notice_link_state`
- `notice_state`
- `notice_stick`
- `notice_type_ids`
- `notice_type_names`
- `source_notice_link`
- `source_home_url`
- `portal_print_url`
- `notice_browser_url`
- `notice_browser_url_source`

### D. Content Summary

- `body_html_hash`
- `block_count`
- `link_count`
- `attachment_ref_count`

### E. Source Retention Routing Summary

- `notice_capture_route`
- `attachment_capture_policy_counts`
- `attachment_capture_state_counts`
- `retention_class_counts`
- `required_source_object_count`
- `metadata_only_attachment_ref_count`
- `quarantine_attachment_ref_count`
- `admitted_source_byte_ref_count`

`notice_capture_route` 属于 notice 级 source retention decision，不属于下游 consumer
admission。它只决定本条 notice 在 source capture / import 阶段是否需要 attachment bytes；
真正进入 notice read model、campus services、regulations 或 unsupported 仍由 downstream
consumer admission manifest 决定。

## Block Rows Canonical 字段

`content-blocks.jsonl` 中每一行至少固定以下字段组。

### A. Block Identity

- `schema_version`
- `raw_asset_id`
- `raw_version_id`
- `row_id`
- `row_index`
- `block_order`

### B. Structural Position

- `block_role`
- `heading_level`
- `parent_heading_path`
- `list_level`
- `table_id`
- `table_row_index`
- `table_col_index`

### C. Content Payload

- `text_raw`
- `text_normalized`
- `html_fragment`
- `link_target`
- `link_text`
- `table_html`
- `table_cells`

`block_role` 推荐值包括：

- `title`
- `heading`
- `paragraph`
- `list_item`
- `table`
- `table_row`
- `table_cell`
- `link`
- `attachment_ref`
- `image`
- `metadata`

## Attachment Ref Canonical 字段

`attachment-refs.jsonl` 中每一行至少固定以下字段组。

### A. Ref Identity

- `schema_version`
- `raw_asset_id`
- `raw_version_id`
- `attachment_ref_id`
- `ref_order`

### B. Source Relation

- `notice_id`
- `relation_source`
- `resource_role`
- `content_kind`
- `anchor_text`

### C. Attachment Identity And Storage Ref

- `source_url`
- `normalized_source_url`
- `final_url`
- `origin_scope`
- `object_key`
- `content_sha256`
- `mime_type`
- `byte_size`

### D. Capture Policy And State

- `notice_capture_route`
- `attachment_capture_policy`
- `attachment_capture_state`
- `byte_fetch_required`
- `byte_fetch_required_reason`
- `required_source_object`
- `source_object_role`

### E. Retention And Promotion

- `retention_class`
- `retention_expires_at`
- `promotion_owner`
- `attachment_promotion_state`
- `promotion_decision_id`
- `promotion_reason_codes`

### F. Terminal Outcome

- `skip_reason`
- `terminal_reason`
- `last_error_class`

`resource_role` 第一版允许：

- `attachment`
- `inline_image`

`notice_capture_route` 和 `attachment_capture_policy` 的顺序固定为 notice-first：

- 先由 notice 标题、正文、portal 分类、notice-family / route policy 与正文质量决定
  `notice_capture_route`
- 再由 notice route、attachment ref 的 source relation、content kind、大小、MIME/type
  allowlist 与 target-required fact gap 决定 `attachment_capture_policy`
- 不允许只因附件是 `pdf`、`docx`、`xlsx`、`zip`、`png` 或其他类型，就绕过 notice route
  直接下载或长期保留 bytes

`attachment_capture_policy` 第一版允许：

- `metadata_only`
- `fetch_to_quarantine`
- `fetch_required_for_source_truth`
- `fetch_required_for_admitted_owner`
- `skip_unsupported`
- `skip_too_large`
- `terminal_unavailable`

`attachment_capture_state` 第一版允许：

- `not_attempted`
- `metadata_recorded`
- `fetching`
- `uploaded_quarantine`
- `uploaded_required`
- `reference_only`
- `terminal_missing`
- `transient_failed`

`retention_class` 第一版允许：

- `permanent_source_truth`
- `metadata_only`
- `quarantine_candidate`
- `admitted_source_bytes`
- `transient_run_artifact`
- `debug_transient`

`attachment_promotion_state` 第一版允许：

- `not_applicable`
- `candidate`
- `promoted`
- `rejected`
- `expired`
- `deleted`

字段语义固定如下：

- `metadata_only` attachment ref 必须保留 source relation、filename / anchor_text、
  source URL、origin scope、MIME/type 和 byte size 等可观测 metadata；`object_key`、
  `content_sha256` 与 `byte_size` 可以为空或只保留已知值，`required_source_object=false`。
- `metadata_only` 的 canonical tuple 是
  `attachment_capture_state=metadata_recorded`、`retention_class=metadata_only`、
  `byte_fetch_required=false`、`required_source_object=false`；不得生成 fetch request
  或 media extraction candidate。
- `fetch_to_quarantine` 允许写入 `object_key`、`content_sha256` 与 `byte_size`，但必须同时写入
  `retention_class=quarantine_candidate` 和 `retention_expires_at`；未 promotion 前不得被视为
  下游 owner source bytes。该 policy 表示 bytes 需要进入 quarantine processing，不等同于
  collector 必须重新 fetch；如果 collector 已经捕获并上传该 ref，状态必须写为
  `uploaded_quarantine`，`byte_fetch_required=false`。
- `fetch_to_quarantine` 如果尚无有效 object-backed bytes，必须保持
  `byte_fetch_required=true` 并进入 fetch request manifest；如果 candidate inventory 已暴露
  `source_capture_repair`，也必须存在对应 fetch request 或 operator action。
- retryable download / upload failure 不得只写 legacy `last_error`。collector 必须写
  `last_error_class=transient_failed`；source retention 必须保留
  `attachment_capture_state=transient_failed`、`byte_fetch_required=true`，并继续进入 fetch
  request / repair 闭环。
- quarantine cleanup 不得只按 `retention_expires_at` 删除 object-backed bytes；如果
  media extraction candidate inventory 中存在 `target_blocking=true` 且引用同一
  `source_object_ref` 的未终态 candidate，则必须阻塞删除。仅当所有阻塞 candidate 已进入
  `completed`、`skipped` 或 `failed_terminal` 后，过期 quarantine bytes 才能按 lifecycle
  cleanup。
- `fetch_required_for_source_truth` 与 `fetch_required_for_admitted_owner` 必须具备
  `object_key`、`content_sha256`、`byte_size` 与 `required_source_object=true`，否则 source
  import / downstream materialization 必须 fail closed。缺 bytes 时只能处于三种状态之一：
  `byte_fetch_required=true` 并进入 fetch request、typed terminal/skip，或
  state-machine audit high finding；不得静默 pending。
- `skip_unsupported`、`skip_too_large` 与 `terminal_unavailable` 是 typed terminal
  outcome；必须记录 `skip_reason` 或 `terminal_reason`，不能靠无限重试或 silent
  missing 表达。
- `skip_unsupported` 与 `skip_too_large` attachment ref 必须满足
  `attachment_capture_state=terminal_missing`、`retention_class=metadata_only`、
  `byte_fetch_required=false`、`required_source_object=false`，且携带 `skip_reason`；不得生成
  fetch request 或 media extraction candidate。
- `terminal_unavailable` attachment ref 必须满足
  `attachment_capture_policy=terminal_unavailable`、`attachment_capture_state=terminal_missing`、
  `retention_class=metadata_only`、`byte_fetch_required=false`、
  `required_source_object=false`，且不得生成 fetch request 或 media extraction candidate。
- collector 新写入的 terminal handoff 必须携带 typed fields：
  `provenance_status=terminal_unavailable`、`ingest_status=terminal_unavailable`、
  `terminal_reason` 与可选 `last_http_status`；`last_error` 只保留 legacy/debug 语义。
- `attachment_promotion_state=promoted` 必须携带 `promotion_owner` 与
  `promotion_decision_id`，用于证明 bytes 是由哪个 target materializer 或 admission
  decision 接收，而不是 collector 默认永久保留。

media extraction candidate inventory 与 closeout result manifest 的 media lifecycle
只允许使用以下 contract-facing 状态：

- `pending`
- `completed`
- `skipped`
- `manual_review`
- `failed_retryable`
- `failed_terminal`

约束：

- `pending`、`manual_review` 与 `failed_retryable` 是非终态；如果 candidate
  `target_blocking=true`，这些状态必须继续阻塞 quarantine cleanup 与 target admission。
  其中 `pending` / `failed_retryable` 对应 target admission 的 `needs_multimodal`，
  `manual_review` 对应 target admission 的 `manual_review`，不得伪装成可自动 OCR 的
  pending work。
- `completed`、`skipped` 与 `failed_terminal` 是终态；它们可以解除对应 candidate 的
  `target_blocking`。
- collector / OCR / preview 的非 contract 状态只能在明确的边界被规范化，例如 `ready` /
  `succeeded` 归一为 `completed`，`low_confidence` / `review` 归一为
  `manual_review`。candidate inventory、closeout result manifest 与 fact-state 主链路不得继续接受
  legacy `failed`；如历史数据存在该状态，必须先进入 audit / repair lane 并显式迁移为
  `failed_retryable` 或 `failed_terminal`。
- target admission 不得只因为 unit 级 `media_text_status=pending` 或
  `multimodal_status=pending` 就进入 `needs_multimodal`；必须存在明确的
  media extraction candidate，且该 candidate 对目标事实 `target_blocking=true`。
- 如果高价值 target unit 的 attachment policy 要求 quarantine/required bytes，但当前 ref
  仍没有 object-backed bytes，candidate inventory 必须产出
  `processing_family=source_capture_repair`、`reason_codes` 包含
  `source_capture_pending` 和 `missing_collected_attachment_bytes`，
  并标记为非 target-blocking gap。
- Phase 4 reimport preview 可以继续报告 unit 级 `needs_multimodal_units` 作为 media
  extraction candidate 生成输入，但其 write manifest 中的 generic consumer admission
  candidate 不得直接把 unit 级 pending 转成下游 `needs_multimodal`；typed downstream
  replay 必须重新消费 fact-state / candidate inventory 后再判定。
- media extraction candidate 只能由显式 source retention / downstream admission policy
  产生。第一版允许 `fetch_to_quarantine`、`fetch_required_for_source_truth` 与
  `fetch_required_for_admitted_owner`；缺少 `attachment_capture_policy` 的历史
  attachment ref 不得靠 `attachment_refs` fallback 自动进入处理。
- media extraction candidate 必须绑定具体 `media_ref_id` / `attachment_ref_id`。audit
  对 `metadata_only`、typed terminal/skip 与 candidate source object 的校验必须按 attachment
  ref 执行，不得把 unit 级 candidate 套到所有 attachment ref。
- stale object ref 不等于 bytes 可用。只有同时具备 `object_key`、`content_sha256` /
  `sha256`、非 `reference_only` 的 `storage_provider`，以及 `downloaded` 或 `uploaded`
  `ingest_status` 时，attachment bytes 才能被视为已采集。
- candidate `source_object_ref` 必须与其 `media_ref_id` 指向的 attachment object-backed
  bytes 匹配；bucket/key 不匹配、attachment 缺有效 bytes、或 candidate 缺 media ref 都必须
  fail closed。
- media extraction attempt ledger 是 candidate execution 的规范化状态投影，schema
  为 `notice_media_extraction_attempt_ledger.v1`。它必须记录 `candidate_id`、
  `unit_id`、`media_ref_id`、`processing_family`、`attempt_number`、contract-facing
  `status`、retry policy、`retry_budget_remaining`、`next_retry_after`、
  `source_object_ref`、`source_object_hash` 与 output ref 计划。
- `notice_media_closeout_target_admission_state_machine_audit.v1` 是 media closeout
  后半段的 fail-closed gate。strict gate 必须同时读取 attempt ledger、closeout
  candidate inventory、target admission manifest、cleanup dry-run report 与 source-object
  verification report；缺任一输入都必须产生 high finding。它还必须对 orphan
  attempt、attempt/candidate source ref 或 hash 不一致、retry budget 缺失、completed
  output refs 缺失、completed closeout 缺失或错配 attempt provenance、非终态 target
  blocker 被 admission ready、target manifest 漏 unit 或 target/source 不一致、cleanup
  未按 bucket/key identity 保护或选中 active quarantine bytes、candidate source object
  未按 bucket/key/hash/size/storage provider 验证等情况产生 medium/high finding。对象验证
  口径遵循 S3-compatible object integrity practice：不能只信 object key；必须具备可核对的
  checksum/hash 与 object size。
- `notice_media_source_object_verification_report.v1` 是 source-object live verification
  report。每行必须包含 bucket、object key、status、storage provider、reference-only
  posture、expected/observed hash、expected/observed size、`check_method` 与
  `live_checked_at`。production strict gate 只接受 `head_checksum` 或 `get_hash`，其中
  `get_hash` 是 HEAD 无可用 checksum 时的受控 fallback。
- direct closeout promotion 与 on-demand closeout promotion 都必须消费通过的
  `notice_media_closeout_target_admission_state_machine_audit.v1`；destructive quarantine
  cleanup 必须消费同一 audit，并通过 `input_hashes.candidate_inventory_sha256` 证明 cleanup
  使用的是被 audit 覆盖的 candidate inventory。

## Collection Extension Fields

某个下游 collection 若确有 source-level 需求，可以在 notice source-truth 上补 extension
fields，但必须满足：

- 不能污染 core schema
- 不能引入 document/chunk 或 serving 语义
- 必须在 collection-specific README 或 strategy doc 中显式记录

当前 `internal_notice -> regulations/institutional_rules` promotion 边界固定补充以下
source-level extension fields，用于在 attachment relation 缺失时保留“semantic owner
应存在”的上游证据：

- `owner_expectation_count`
- `owner_expectations`

`owner_expectations[*]` 第一版字段固定为：

- `owner_expectation_id`
- `owner_kind`
- `relation_type`
- `evidence_reason`
- `owner_title_hint`
- `evidence_text`

约束：

- 它们只表达“notice 正文明确声明存在 attachment/file-release owner，但当前 source-truth relation
  尚未恢复出来”
- 它们不替代真实的 `attachment-refs.jsonl`
- 不得伪造 `object_key`、`content_sha256`、`byte_size` 等 attachment identity 字段
- 下游只能把它们用于 fail-close、manual review 和 owner recovery，不得把它们当作真实 attachment
  document 已存在

## 明确禁止的字段

以下字段不属于 notice source-truth schema：

- `document_id`
- `revision_track`
- `version_id`
- `chunk_id`
- `chunk_order`
- `embedding`
- vector payload
- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`
- query-serving gate metadata
- collector 本地 `local_path`
- collector SQLite 主键或运行时内部表引用

这些字段如有需要，必须在 projection、document registry、chunking 或 serving 阶段生成。

## Replay / Rebuild Boundary

当 canonical notice source-truth 已存在时：

- projection / rebuild 必须从
  `source-truth/notice-manifest.json`、`content-blocks.jsonl` 与
  `attachment-refs.jsonl` 开始
- later rebuild 不得返回 bootstrap export、collector SQLite 或本地附件目录重新吸收
- provider artifacts 只作为排障与 source-truth 重建输入，不作为长期下游 contract

## 与 document truth 的关系

notice source-truth 不等于逻辑 document 真相。

因此这里固定：

- 一条 notice source-truth 通常可以投影成一条逻辑 document
- 附件可以作为 attachment refs 留在 source-truth，也可以在下游投影成独立 document family
- `document_id`、`revision_track`、`version_id`、restricted projection 由下游
  projection / registry 决定

## 非目标

- 不在本文冻结 collector 本地缓存形态
- 不在本文冻结 HTML 清洗算法实现
- 不在本文定义 restricted entitlement policy
- 不在本文定义 collection-specific chunking 或 index release 策略

如需定义 `campus_notices/internal_notice` 的 parent notice / attachment lane
split、cleanup、chunk-preparation 与 release gate，固定查看
`docs/reference/internal-notice-offline-preparation-strategy.md`。

## Async Staged Closeout Integration

Phase 12.2 的 async staged closeout 保持 source-truth 与 document truth 的清晰隔离：所有历史
notice artifacts 依然从 `source-truth/*` 重建，per-run 状态则落在
`campus_notices/operations/authenticated-notice-closeout/{run_id}/` 和
`ingestion_closeout.closeout_*` staging 表。后续 batch-leased throughput executor
进一步把 progress truth 明确拆到 `closeout_batches` / `closeout_workers`，但 source-truth
与 final document truth 的 ownership 不变。只有单个 promoter 读取
`closeout_document_stage`、`closeout_notice_stage` 等表、验证 staged digests、才会把
artifact 引用复制到 `campus_notices/documents/internal_notice/...` 并执行
`replace_scope`。这样在保证 source-truth 不含 document/chunk/serving 字段的前提下，仍能按阶段化
pipeline 对历史导出做 deterministic promotion，详见
`docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md` 与 `docs/
decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`。

## 与其他文档的关系

- source channel
  运行边界：`docs/architecture/domains/authenticated-notice/architecture.md`
- shared source-truth principles：`docs/architecture/system/data-plane-architecture.md`
- `internal_notice` collection-specific offline preparation
  strategy：`docs/reference/internal-notice-offline-preparation-strategy.md`
- restricted document center artifact
  contract：`docs/reference/restricted-document-center-artifact-contract.md`
- restricted authorization：`docs/decisions/adr-0022-campus-identity-and-restrict
  ed-document-authorization.md`
- object storage key 约定：`docs/decisions/adr-0002-local-minio-conventions.md`
