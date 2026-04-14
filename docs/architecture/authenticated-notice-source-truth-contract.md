---
doc_type: architecture
status: active
created: 2026-04-03
updated: 2026-04-12
---

# Authenticated Notice Source-Truth Contract

## 文档边界

本文冻结 `authenticated_notice_portal` source channel 的 canonical source-truth contract。

当前作用域只覆盖 `notice` surface，不覆盖同一 portal 下的 `file_release` surface。`file_release` 当前仍停留在 collector-owned typed export / source capture 阶段，不能反向改写本文的 notice source-truth contract。

`file_release` 当前 export contract 另见：

- `docs/reference/authenticated-notice-file-release-export-contract.md`

它回答的是：

- notice source 在 `capture/`、`provider/`、`source-truth/` 三层分别保留什么
- notice source-truth 的 notice-level、block-level 与 attachment-ref-level canonical 字段是什么
- 哪些字段属于 source-truth，哪些字段明确不属于
- 登录态 notice source-truth 如何与下游 document/chunk/restricted serving 解耦

它不负责：

- 具体登录方式或认证刷新策略
- collector 调度与 run lifecycle admission
- 某个 collection 的 cleanup / chunking / retrieval 策略
- entitlement policy 的最终解释

对应文档：

- source-channel 运行边界：`docs/architecture/authenticated-notice-source-architecture.md`
- `file_release` collector-owned export contract：`docs/reference/authenticated-notice-file-release-export-contract.md`
- shared replay / rebuild boundary：`docs/architecture/data-plane-architecture.md`
- `internal_notice` collection-specific offline preparation strategy：`docs/reference/internal-notice-offline-preparation-strategy.md`
- restricted rollout：`docs/architecture/identity-and-authorization-architecture.md`

## 目标

登录态 notice source-truth 的目标是把“门户内一条稳定 notice 资源”的正文、分类、链接和附件关系吸收成可 replay、可 fan-out、可审计的 canonical upstream，而不是让下游长期依赖 collector 自己的 SQLite/export shape。

## 核心结论

- source-truth unit 固定为稳定的 `notice` 资源，而不是某次采集 run 或某次 API 请求实例
- source-truth 必须同时保留 notice identity、fetch provenance、正文 block truth 与 attachment refs
- source-truth 可以服务多个下游 collection / corpus，但不得提前携带 document、chunk、retrieval 或 serving 语义
- 一旦 canonical notice source-truth 存在，后续 replay / rebuild 必须从 source-truth 开始，而不是返回 bootstrap export 或 collector DB

## Canonical 形态

`capture artifacts -> provider artifacts -> notice source-truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`

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

`provider/` 保存 source-specific normalize 输出，供排障、升级 normalize 逻辑与重建 source-truth 使用。

长期 canonical artifacts 固定为：

- `provider/normalized-notice.json`
- `provider/discovered-links.jsonl`
- `provider/attachment-observations.jsonl`

说明：

- `normalized-notice.json` 可以包含 collector 侧 notice metadata、HTML normalize、分类聚合与 source-specific flags
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

### D. Content Summary

- `body_html_hash`
- `block_count`
- `link_count`
- `attachment_ref_count`

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

`resource_role` 第一版允许：

- `attachment`
- `inline_image`

## Collection Extension Fields

某个下游 collection 若确有 source-level 需求，可以在 notice source-truth 上补 extension fields，但必须满足：

- 不能污染 core schema
- 不能引入 document/chunk 或 serving 语义
- 必须在 collection-specific README 或 strategy doc 中显式记录

当前 `internal_notice -> regulations/institutional_regulations` promotion 边界固定补充以下 source-level extension fields，用于在 attachment relation 缺失时保留“semantic owner 应存在”的上游证据：

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

- 它们只表达“notice 正文明确声明存在 attachment/file-release owner，但当前 source-truth relation 尚未恢复出来”
- 它们不替代真实的 `attachment-refs.jsonl`
- 不得伪造 `object_key`、`content_sha256`、`byte_size` 等 attachment identity 字段
- 下游只能把它们用于 fail-close、manual review 和 owner recovery，不得把它们当作真实 attachment document 已存在

## 明确禁止的字段

以下字段不属于 notice source-truth contract：

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

- projection / rebuild 必须从 `source-truth/notice-manifest.json`、`content-blocks.jsonl` 与 `attachment-refs.jsonl` 开始
- later rebuild 不得返回 bootstrap export、collector SQLite 或本地附件目录重新吸收
- provider artifacts 只作为排障与 source-truth 重建输入，不作为长期下游 contract

## 与 document truth 的关系

notice source-truth 不等于逻辑 document 真相。

因此这里固定：

- 一条 notice source-truth 通常可以投影成一条逻辑 document
- 附件可以作为 attachment refs 留在 source-truth，也可以在下游投影成独立 document family
- `document_id`、`revision_track`、`version_id`、restricted projection 由下游 projection / registry 决定

## 非目标

- 不在本文冻结 collector 本地缓存形态
- 不在本文冻结 HTML 清洗算法实现
- 不在本文定义 restricted entitlement policy
- 不在本文定义 collection-specific chunking 或 index release 策略

如需定义 `campus_notices/internal_notice` 的 parent notice / attachment lane split、cleanup、chunk-preparation 与 release gate，固定查看 `docs/reference/internal-notice-offline-preparation-strategy.md`。

## Async Staged Closeout Integration

Phase 12.2 的 async staged closeout 保持 source-truth 与 document truth 的清晰隔离：所有历史 notice artifacts 依然从 `source-truth/*` 重建，per-run 状态则落在 `campus_notices/operations/authenticated-notice-closeout/{run_id}/` 和 `ingestion_closeout.closeout_*` staging 表。后续 batch-leased throughput executor 进一步把 progress truth 明确拆到 `closeout_batches` / `closeout_workers`，但 source-truth 与 final document truth 的 ownership 不变。只有单个 promoter 读取 `closeout_document_stage`、`closeout_notice_stage` 等表、验证 staged digests、才会把 artifact 引用复制到 `campus_notices/documents/internal_notice/...` 并执行 `replace_scope`。这样在保证 source-truth 不含 document/chunk/serving 字段的前提下，仍能按阶段化 pipeline 对历史导出做 deterministic promotion，详见 `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md` 与 `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`。

## 与其他文档的关系

- source channel 运行边界：`docs/architecture/authenticated-notice-source-architecture.md`
- shared source-truth principles：`docs/architecture/data-plane-architecture.md`
- `internal_notice` collection-specific offline preparation strategy：`docs/reference/internal-notice-offline-preparation-strategy.md`
- restricted authorization：`docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- object storage key 约定：`docs/decisions/adr-0002-local-minio-conventions.md`
