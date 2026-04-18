---
doc_type: reference
status: active
created: 2026-04-12
updated: 2026-04-18
---

# Authenticated Notice File-Release Export Contract

## 文档边界

本文冻结 `authenticated_notice_portal/file_release` 当前 repo-tracked export contract。

它回答的是：

- collector 为 `file_release` 导出什么 bundle / manifest
- bundle row 和 manifest 的字段语义是什么
- `reference_only` 与 `object_store_write` 各自代表什么
- released file 的对象存储 key 如何编排

它不负责：

- 把 `file_release` 提升成 canonical `notice` source-truth
- replay、promotion、OCR、chunk、index、release
- 认证刷新细节或 live 操作步骤

对应文档：

- source-channel 边界：`docs/architecture/authenticated-notice-source-architecture.md`
- notice source-truth contract：`docs/architecture/authenticated-notice-source-truth-contract.md`
- auth-window 执行步骤：`docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md`
- downstream readiness：`docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md`

## 核心定位

`file_release` 当前仍是：

- `authenticated_notice_portal` 下的 sibling authenticated surface
- collector-owned capture / export slice
- next auth window 的 source capture target

它当前不是：

- canonical `notice` source-truth
- `internal_notice` replay 输入
- regulation promotion 输入

固定规则：

- `file_release` 必须和 `notice` 分开采集、分开导出
- 任何 `file_release` bundle / manifest 都不能反向改写 `notice` source-truth contract
- 当前 run 的 stop point 固定是 capture-side artifacts 与可选源文件上传

## 导出文件

当前 `file-release:export` 固定在 collector `runtime/exports/` 下写出两类文件：

- `file-releases-bundle-<timestamp>.json`
- `file-releases-manifest-<timestamp>.json`

其中 `<timestamp>` 采用 export UTC timestamp 的紧凑格式，例如：

- `20260412T003000Z`

对应 `export_scope` 分两种：

- full export：`file-release-<timestamp>`
- targeted export：`file-release-target-<file_release_id>-<timestamp>`

## Schema Version

当前 export contract version 固定为：

- `authenticated_notice_file_release_export_v1`

它同时出现在：

- manifest `schema_version`
- collector metadata `export_contract_version`

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
  - 固定为 `authenticated_notice_file_release_export_v1`
- `exported_at`
- `export_date`
- `export_scope`
- `source_channel`
  - 固定为 `authenticated_notice_portal`
- `source_surface`
  - 固定为 `file_release`
- `site_id`
- `source_home_url`
- `collector`
- `filters`
- `observed_file_types`
- `observed_departments`
- `run`

### `collector`

collector metadata 固定包括：

- `runtime_shell`
  - 固定为 `repo_local_node`
- `export_contract_version`
  - 固定为 `authenticated_notice_file_release_export_v1`
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

- `AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE`
- `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES`
- `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS`
- `AUTHENTICATED_NOTICE_FILE_RELEASE_TARGET_ID`

其中 `target_file_release_id` 固定代表：

- 单个精确 `file_release_id`
- 为下一次 auth window 的 bounded capture 提供“只抓这一条”的 selector
- 不是模糊搜索，也不是 collector 侧的通用查询语义

collector 当前固定行为：

- 未设置 `target_file_release_id` 时，继续按现有 full export / quantity-bounded export 语义执行
- 设置 `target_file_release_id` 时，只允许导出该 `file_release_id` 对应的 bundle row
- 如果 traversed export scope 内没有命中目标 `file_release_id`，collector 必须 fail-close，不能写出空 bundle 的伪成功结果

## Storage Semantics

released file 的 capture 结果只允许两种解释：

### `reference_only`

表示：

- collector 只恢复了可下载 URL 和 portal metadata
- 没有把文件字节写入对象存储

固定表现：

- `collector.file_storage_mode=reference_only`
- `released_file.storage_provider=reference_only`
- `released_file.provenance_status=reference_only`
- `released_file.ingest_status=reference_only`
- `released_file.bucket/object_key/sha256/byte_size/uploaded_at` 为空

这不是失败态，而是“只捕获引用、不捕获字节”的显式 contract。

### `object_store_write`

表示：

- collector 已下载 released file 字节
- collector 已把源文件写入 source bucket

固定表现：

- `collector.file_storage_mode=object_store_write`
- `collector.file_release_collection_mode=prompt_portlet_materialized`
- `released_file.storage_provider=object_store`
- `released_file.provenance_status=collected_internal`
- `released_file.ingest_status=uploaded`
- `released_file.bucket/object_key/sha256/byte_size/uploaded_at` 非空

## Object Key Contract

当 released file 被写入 source bucket 时，object key 固定采用：

`authenticated_notice_portal/file-release-{id}/{year}/sha256-{digest}/capture/{filename}`

示例：

`authenticated_notice_portal/file-release-646/2026/sha256-<digest>/capture/中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf`

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
- 不在这条导出线上继续 replay、OCR、promotion、chunk、index
- 不把 `target_file_release_id` 扩成标题模糊匹配、notice 关联搜索或多条件 query surface
- targeted export 未命中目标 `file_release_id` 时，不静默落空成功结果

## Verification Anchor

当前 contract 的实现锚点在：

- `apps/authenticated-notice-collector/src/file-release-export.ts`
- `apps/authenticated-notice-collector/src/types.ts`
- `apps/authenticated-notice-collector/test/file-release-export.test.ts`

如果代码与本文冲突，以实现和测试修正本文，或在同一提交中同步升级 version；不得静默漂移。
