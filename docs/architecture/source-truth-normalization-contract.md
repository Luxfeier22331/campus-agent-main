---
doc_type: architecture
status: active
created: 2026-03-27
updated: 2026-03-27
---

# OCR Source-Truth Normalization Contract

## 文档边界

本文冻结 repo 级 OCR/source-truth canonical contract。

它回答的是：

- provider raw payload 进入 repo 之后，什么才算 canonical source-truth
- 哪些字段属于 source-truth，哪些字段明确不属于
- 一份 source-truth 如何服务多份 projection / collection / corpus

它不负责：

- handbook 的 split/document cleanup 细节
- curriculum 的 document-level chunking 细节
- retrieval / chunking / embedding runtime 策略

collection-specific 规则以对应 strategy doc 或 `configs/ingestion/<corpus>/<collection>/` 为准。

## 核心结论

- source-truth 是 provider-agnostic 的 layout truth，不是 document truth
- source-truth 是 replay/rebuild 的 canonical shared upstream
- raw/source-truth 只消费一次，后续 fan-out 通过 declared projections 执行
- 一份 source-truth 可以对应多份下游 collection/corpus，但不得为新增下游返回 raw 重新消费
- source-truth 不得提前携带 document/chunk/retrieval 语义

canonical 形态固定为：

`provider raw payload -> source-truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`

## 与 provider 的边界

`provider-response.jsonl` 保留 provider 原始响应，职责只包括：

- provenance
- 审计
- 排障
- source-truth 重建输入

下游不得把 provider raw payload 直接视为长期 contract。

当前对 PaddleOCR / PP-StructureV3 的吸收边界固定为：

- page-level layout parsing result
- block/category labels
- reading order
- bbox / polygon
- markdown fallback
- table html / table cells

只要这些能力边界不变，更换 PaddleOCR 的部署方式或调用入口不应迫使 source-truth downstream 重写。

## Source-Truth 的 ownership

source-truth 的 ownership 在 source asset，不在 collection。

这意味着：

- 一份 raw source asset 只生成一份 canonical source-truth
- 一份 source-truth 可以 fan-out 到同一 `corpus` 下多份 `collection`
- 一份 source-truth 也可以 fan-out 到不同 `corpus` 下多份 `collection`

典型例子：

- 同一份 handbook source-truth 可以同时派生出 `regulations/student_handbook`
- 同一份 handbook source-truth 也可以派生出 `campus_services/contact_directory`
- 同一份 handbook source-truth 还可以派生出 `campus_services/service_catalog`

## Canonical 字段组

source-truth canonical contract 至少固定以下字段组。

### A. Source Identity

- `schema_version`
- `corpus`
- `collection`
- `source_artifact_id`
- `source_pdf`
- `page_start`
- `page_end`
- `row_id`
- `row_index`

### B. Provider Provenance

- `ocr_provider`
- `ocr_model`
- `provider_page_id`
- `provider_block_id`
- `provider_payload_ref`
- `confidence`

### C. Layout Structure

- `row_type`
- `block_role`
- `heading_level`
- `reading_order`
- `bbox`
- `text_raw`
- `text_normalized`
- `html`
- `table_cells`
- `is_blank`

### D. Source-Level Hints

- `is_repeated_candidate`
- `title_candidate_score`
- `section_hint`
- `classification_confidence`
- `classification_reason`
- `repeat_cluster_id`
- `repeat_frequency`
- `repeat_position_band`
- `parent_heading_hint`
- `list_level_hint`
- `continues_from_previous_page`
- `continues_to_next_page`
- `table_fragment_id`
- `table_header_rows`
- `table_row_count`
- `table_column_count`
- `table_has_merged_cells`
- `table_caption_hint`

### E. Collection Extension Fields

collection 确有 source-level 需求时，可以补 extension fields，但必须满足：

- 不能污染 core schema
- 不能引入 document/chunk 层语义
- 必须在 collection 文档中显式记录

例如 curriculum 当前保留：

- `owner_row_id`
- `relation_type`
- `continuation_group_id`

## 明确禁止的字段

以下字段不属于 source-truth contract：

- `doc_id`
- `document_id`
- `version_id`
- `revision_track`
- `chunk_id`
- `clean_text`
- retrieval payload fields
- serving metadata
- registry-only metadata

这些字段如果出现，应在 document-level cleaning、document-units 或 chunking 之后生成。

## 命名规则

source-truth 相关术语固定如下：

- `provider-response`
  provider 原始响应
- `source-truth`
  provider-agnostic layout truth
- `source_truth_only`
  只落 raw/provider/source-truth、尚不进入 document registry 的 pre-split ingestion mode
- `normalized`
  进入 document-level ingestion 的模式

禁止继续使用 `provider_only` 作为长期 artifact mode 命名。

## 质量语义

`classification_confidence` 的语义固定为：

- 规则/启发式分类置信度
- 仅表达 source-truth row typing 的内部信号

它不表示：

- 最终文档语义正确率
- retrieval relevance
- 结构恢复的完整质量分数

因此它只能服务：

- split / cleanup hints
- source-truth 质量回归
- 规则解释与排障

不能把它上升为 retrieval 或 serving 层的最终置信度。

## Replay / Rebuild Boundary

当 canonical source-truth 已存在时：

- replay/rebuild 必须从 source-truth 开始
- later projection 不得返回 raw
- attachment / appendix / service-like derived document 也必须从 source-truth fan-out

这条规则同时适用于：

- handbook primary documents
- campus services derived documents
- 未来其他 source-shared collection

## 与其他文档的关系

- phase-1 数据平面边界：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- handbook source-truth / split / document-level 规则：`docs/architecture/student-handbook-ocr-normalization-strategy.md`
- curriculum collection-specific extension：`configs/ingestion/curriculum/curriculum_plan/README.md`
