---
doc_type: contract
truth_scope: data
owner_boundary: docs/contracts
status: active
created: 2026-04-12
updated: 2026-07-08
---
# File Release Export Contract

## 文档边界

本文冻结 `internal_portal/file_release` 当前 repo-tracked export contract。

它回答的是：

- collector 为 `file_release` 导出什么 bundle / manifest
- bundle row 和 manifest 的字段语义是什么
- collector 会额外快照哪些 portal selector / taxonomy truth
- `reference_only` 与 `object_store_write` 各自代表什么
- released file 的对象存储 key 如何编排
- collector -> ingestion-control materialization handoff 中 `file_release`
  必须提供哪些 object refs 和 verification fields

它不负责：

- 把 `file_release` 提升成 canonical `notice` source-truth
- replay、promotion、OCR、chunk、index、release
- query-serving 或 downstream semantic promotion opening
- 认证刷新细节或 live 操作步骤

对应文档：

- source-channel
  边界：`docs/architecture/domains/authenticated-notice/architecture.md`
- notice source-truth
  contract：`docs/data/authenticated-notice.md`
- auth-window
  执行步骤：`docs/runbooks/notice-release-auth-window.md`

## 核心定位

`file_release` 当前是：

- `internal_portal` 下的 sibling authenticated surface
- collector-owned capture / export slice
- object-backed `authenticated_documents/file_release_source` 的 source input

它不是：

- canonical `notice` source-truth
- `internal_notice` replay 输入
- regulation promotion 输入
- query-serving surface

固定规则：

- `file_release` 必须和 `notice` 分开采集、分开导出
- 任何 `file_release` bundle / manifest 都不能反向改写 `notice` source-truth contract
- `object_store_write` file_release 可以进入 `authenticated_documents/file_release_source`
  document holding
- `reference_only` file_release 只能停在 capture evidence / operator gap，不进入 document
  holding
- `file_release_source` 不自动进入 `regulations/*`、service-status、chatbot、panel 或
  query-serving

ingestion-control / operator projection 的 posture 固定为：

- `captured_only`：只保留 capture evidence，不能作为 materialization source
- `object_backed_source_ready`：released original 已在 source bucket 中验证，可进入
  ingestion-control 的 `source_truth_materialize` task
- `imported_holding`：source-truth / document holding artifacts 已由 ingestion-control
  materialize，document registry 可作为下游 owner recovery 的唯一 repo-local 查询入口
- `downstream_admitted`：已有后续 owner 显式 admission / read model 证据；
  本 contract 不默认打开该状态

## 导出文件

collector 可以在本地 operator work dir 下保留两类 export 文件副本：

- `file-releases-bundle-<timestamp>.json`
- `file-releases-manifest-<timestamp>.json`

其中 `<timestamp>` 采用 export UTC timestamp 的紧凑格式，例如：

- `20260412T003000Z`

对应 `export_scope` 分两种：

- full export：`file-release-<timestamp>`
- targeted export：`file-release-target-<file_release_id>-<timestamp>`

跨 Docker runtime handoff 不能依赖上述本地路径。主链路 handoff 必须由
source bucket object refs 与 run ledger 表达；当前 mainline task input 必须是
explicit object refs，不能要求 ingestion-control executor 通过 run ledger 隐式猜测
bundle / manifest。

## Portal Selector Snapshot

除了 list/detail/download-url 记录外，collector 在每次 export 时还会快照当前 portal 的 selector
truth：

- `/comsys-prompt-portlet-web/getFileType`
  - `observed_file_types`
- `/comsys-prompt-portlet-web/getFileFileType`
  - `observed_file_code_types`
- `/comsys-prompt-portlet-web/getExplainDepts`
  - `observed_explain_departments`

这些字段的作用是：

- 冻结本次 export 看到的 `file_release` 分类与说明部门全集
- 让后续 owner recovery / downstream triage 可以基于真实 portal taxonomy，而不是只看当前 bundle
  rows 中碰巧出现的子集
- 明确 `制度汇编/制度管理` 这类管理视图依然属于 `file_release` family，而不是新的第三 source family

## Schema Version

当前 export contract version 固定为：

- `internal_portal_file_release_export_v1`

它同时出现在：

- manifest `schema_version`
- capture runtime metadata `export_contract_version`

## Bundle Shape

bundle 顶层是 `BundleFileReleaseRecord[]`。

每一行固定由三段组成：

- `file_release_id`
- `file_release`
- `released_file`

### `file_release`

`file_release` 保存 portal `pageFile/getFile/getFileUrl` 聚合后的记录级 metadata。

关键字段包括：

- `source_surface`
  - 固定为 `file_release`
- `filename`
- `filecode`
- `filetime`
- `filedepartment`
- `explain_department`
- `publisher_user_name`
- `file_type_id`
- `file_type_name`
- `original_portal_file_url`
- `resolved_download_url`
- `upfilename`
- `important`
- `det_important`
- `role`
- `last_seen_at`
- `enrich_attempted_at`

### `released_file`

`released_file` 保存 released source file 的 capture outcome。

关键字段包括：

- `source_url`
- `normalized_source_url`
- `final_url`
- `original_filename`
- `mime_type`
- `byte_size`
- `sha256`
- `storage_provider`
- `bucket`
- `object_key`
- `etag`
- `version_id`
- `origin_url_scheme`
- `origin_host`
- `origin_scope`
- `provenance_status`
- `ingest_status`
- `local_path`
- `downloaded_at`
- `uploaded_at`
- `last_error`
- `created_at`
- `updated_at`

## Manifest Shape

manifest 顶层固定为 `FileReleaseExportManifest`。

关键字段包括：

- `schema_version`
  - 固定为 `internal_portal_file_release_export_v1`
- `exported_at`
- `export_date`
- `export_scope`
- `source_channel`
  - 固定为 `internal_portal`
- `source_surface`
  - 固定为 `file_release`
- `site_id`
- `source_home_url`
- `capture_runtime`
- `filters`
- `observed_file_types`
- `observed_departments`
- `observed_file_code_types`
- `observed_explain_departments`
- `run`

### `capture_runtime`

capture runtime metadata 固定包括：

- `runtime_shell`
  - 固定为 `source_collector_node`
- `export_contract_version`
  - 固定为 `internal_portal_file_release_export_v1`
- `file_release_collection_mode`
  - `prompt_portlet_reference_only`
  - `prompt_portlet_materialized`
- `file_storage_mode`
  - `reference_only`
  - `object_store_write`

### `filters`

当前 bounded export filter 固定包括：

- `page_size`
- `max_pages`
- `max_file_releases`
- `target_file_release_id`

它们分别对应以下 env：

- `INTERNAL_PORTAL_FILE_RELEASE_PAGE_SIZE`
- `INTERNAL_PORTAL_FILE_RELEASE_MAX_PAGES`
- `INTERNAL_PORTAL_FILE_RELEASE_MAX_ITEMS`
- `INTERNAL_PORTAL_FILE_RELEASE_TARGET_ID`

其中 `target_file_release_id` 固定代表：

- 单个精确 `file_release_id`
- 为下一次 auth window 的 bounded capture 提供“只抓这一条”的 selector
- 不是模糊搜索，也不是 collector 侧的通用查询语义

collector 当前固定行为：

- 未设置 `target_file_release_id` 时，继续按现有 full export / quantity-bounded export
  语义执行
- 设置 `target_file_release_id` 时，只允许导出该 `file_release_id` 对应的 bundle row
- 如果 traversed export scope 内没有命中目标 `file_release_id`，collector 必须
  fail-close，不能写出空 bundle 的伪成功结果

### `observed_file_types`

来自 `/getFileType`，表示 portal 当前返回的一级文件分类全集。

每项固定包含：

- `id`
- `typename`
- `sort`

### `observed_departments`

来自 `pageFile` 响应里的 `dws`，表示本次遍历窗口实际观测到的 `filedepartment` 去重集合。

它表达的是：

- 本次 list traversal 实际命中的部门值

它不表达：

- portal 全量说明部门全集

### `observed_file_code_types`

来自 `/getFileFileType`，表示 portal 当前返回的文件字号 / 编码类型全集。

每项固定包含：

- `id`
- `name`
- `sort`

### `observed_explain_departments`

来自 `/getExplainDepts`，表示 portal 当前返回的说明部门全集。

固定表现：

- 即使本次 bundle rows 只覆盖其中少量部门，manifest 仍保留 portal 全量 selector snapshot

## Storage Semantics

released file 的 capture 结果只允许两种解释：

### `reference_only`

表示：

- collector 只恢复了可下载 URL 和 portal metadata
- 没有把文件字节写入对象存储

固定表现：

- `capture_runtime.file_storage_mode=reference_only`
- `released_file.storage_provider=reference_only`
- `released_file.provenance_status=reference_only`
- `released_file.ingest_status=reference_only`
- `released_file.bucket/object_key/sha256/byte_size/uploaded_at` 为空

这不是失败态，而是“只捕获引用、不捕获字节”的显式 contract。

在 `file_release_source` materialization 中，`reference_only` 是 fail-closed input：
ingestion-control 可以报告它，但不能把它导入 document holding，也不能伪造 raw/source
object locator。

### `object_store_write`

表示：

- collector 已下载 released file 字节
- collector 已把源文件写入 source bucket

固定表现：

- `capture_runtime.file_storage_mode=object_store_write`
- `capture_runtime.file_release_collection_mode=prompt_portlet_materialized`
- `released_file.storage_provider=object_store`
- `released_file.provenance_status=collected_internal`
- `released_file.ingest_status=uploaded`
- `released_file.bucket/object_key/sha256/byte_size/uploaded_at` 非空

`object_store_write` 进入 handoff 前还必须满足：

- source bucket 中的 released source object 可 `HEAD`
- object byte size 与 `released_file.byte_size` 一致
- object sha256 与 `released_file.sha256` 一致
- verification result 写入 run ledger

## File-Release Handoff Fields

`file_release` collector success handoff 必须提供：

- `run_id`
- `source_channel=internal_portal`
- `source_surface=file_release`
- `site_id`
- `source_bucket`
- `bundle_object_key`
- `bundle_content_sha256`
- `bundle_byte_size`
- `manifest_object_key`
- `manifest_content_sha256`
- `manifest_byte_size`
- `required_source_object_count`
- `verified_source_object_count`
- `missing_source_object_count`
- `checksum_mismatch_count`
- `size_mismatch_count`
- `verification_status`
- `verified_at`
- `status`
- `failure_reason`

`run_id` consumer 只能消费这份 read contract。`bundle_path` / `manifest_path`
local fields 可以保留在 dev/debug report 中，但不能作为 Docker collector 与
ingestion-control 之间的 handoff truth。

## Object Key Contract

当 released file 被写入 source bucket 时，object key 固定采用：

`internal_portal/file-release-{id}/{year}/sha256-{digest}/capture/{f
ilename}`

示例：

`internal_portal/file-release-646/2026/sha256-<digest>/capture/中央民族大
学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf`

约束：

- `id` 固定来自 `file_release_id`
- `year` 优先从 `filetime` 推断；缺失时回退 `unknown-year`
- `digest` 固定使用文件字节 `sha256`
- `capture/` 表示当前仍是 source capture layer，不是 source-truth / document / chunk 层

## Fail-Close Rules

当前 contract 固定 fail-close 于以下边界：

- 不把 `file_release` 记录伪装成 `notice`
- 不把 `reference_only` 误写成“已完成源文件捕获”
- 不把 bundle / manifest 直接当成 canonical source-truth
- 不让 `reference_only` row 进入 `authenticated_documents/file_release_source`
- 不在这条导出线上继续 replay、OCR、promotion、chunk、index
- 不把 `local_path` 当成跨 runtime handoff field
- 不把 `target_file_release_id` 扩成标题模糊匹配、notice 关联搜索或多条件 query surface
- targeted export 未命中目标 `file_release_id` 时，不静默落空成功结果

## Verification Anchor

当前 contract 的实现锚点在：

- `apps/source-collector/adapters/internal-portal/src/file-release-export-core.ts`
- `apps/source-collector/adapters/internal-portal/src/file-release-crawlee-runner.ts`
- `apps/source-collector/adapters/internal-portal/src/types.ts`
- `apps/source-collector/adapters/internal-portal/test/file-release-export.test.ts`
- `configs/ingestion/authenticated_documents/file_release_source/task-registry.v2.json`
- `apps/ingestion-control/src/authenticated-file-release-materialize.ts`
- `apps/ingestion-control/test/authenticated-file-release-materialize.test.ts`

如果代码与本文冲突，以实现和测试修正本文，或在同一提交中同步升级 version；不得静默漂移。
