---
doc_type: plan
status: completed
created: 2026-03-27
updated: 2026-03-27
---

# OCR Source-Truth 无债务重构实施方案

**Goal:** 把当前 OCR `provider-response -> source-truth -> projection -> document-units -> chunk/index` 链路重构为一套不依赖过渡命名、不保留前移语义、不再分叉扩建 handbook/curriculum 私有核心逻辑的长期正确实现。

**Architecture:** 本次方案不重新讨论 phase-1 是否采用对象存储、source-truth 或 projection fan-out，这些长期边界已在 architecture / ADR 中接受。本文只把当前仍存在的 OCR/source-truth 实现债务收口成一份可执行重构计划，目标是把 source-truth 层恢复为真正的 provider-agnostic layout truth，并让 handbook / curriculum 都建立在同一 shared core 上。

**Tech Stack:** Markdown docs, `packages/ingestion-core`, repo-tracked ingestion configs, `uv` unittest baseline

## 完成状态

截至 2026-03-27，本计划已完成，当前仓库已经落地以下收口结果：

- repo 级 source-truth canonical contract 已冻结到 `docs/architecture/source-truth-normalization-contract.md`
- handbook / curriculum 共同依赖 `packages/ingestion-core/src/campus_ingestion_core/source_truth_common.py` 作为 shared source-truth core
- `provider_only` 已从当前代码/配置/文档基线中移除，artifact mode 固定为 `source_truth_only`
- `semantic_confidence` 已收口为 `classification_confidence`
- source-truth 层已删除 `clean_text`、`chunk_id` 等 document/chunk 前移语义
- repo 已新增显式 source-truth 质量门禁：`tests/ingestion/test_source_truth_quality_gate.py`
- 该门禁覆盖 handbook / curriculum 的 heading、repeat detection、cross-page continuation、table hints / continuation，以及真实 fixture 回归

---

## 摘要

本方案只回答四件事：

- 当前 OCR/source-truth 链路里还剩哪些真实债务
- 长期正确的 source-truth contract 应该冻结成什么形状
- handbook / curriculum 应该如何在 shared source-truth core 上实现，而不是继续各自分叉
- 哪些过渡术语、过渡字段、过渡路径必须在本轮被删除

本轮明确不做：

- 不重新设计 retrieval baseline
- 不冻结新的 chunking 策略
- 不把 source-truth 直接升级成 retrieval-ready semantic truth
- 不把 provider raw payload 当长期 contract 暴露给下游

## 背景结论

当前仓库的方向已经基本正确：

- source bucket 与 derived bucket 已经分层
- `provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> document-units.jsonl` 的主链路已存在
- source-truth-first、single-source-consumption、projection fan-out 的长期方向已写入 architecture / ADR

但实现仍有以下残余债务：

- handbook 与 curriculum 仍然维护两套未完全收敛的 provider normalization / source-truth core
- `curriculum_layout_elements_v2` 中仍残留 `clean_text`、`chunk_id` 等不应出现在 source-truth 层的前移语义
- source-truth 层的 `semantic_confidence` 实际表达的是规则分类置信度，命名容易误导后续评估
- `RAW_INGESTION_ARTIFACT_MODE=provider_only` 仍是过渡命名，不符合当前 canonical rebuild boundary 已经提升到 `source-truth` 的事实
- repo 仍缺一份跨 collection 的 source-truth canonical contract；当前知识分散在 handbook strategy、curriculum README 和实现代码里

## 长期目标

本轮重构后的 canonical 数据平面应固定为：

`provider raw payload -> canonical source-truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> dense/sparse index`

其中边界固定如下：

- `provider-response.jsonl`
  只保存 provider 原始响应，用于 provenance、审计、排障和重放
- `source-truth/layout-elements.jsonl`
  只保存 provider-agnostic 的版面结构真相与 source-level hints
- projection
  只负责从 source-truth fan-out 到 handbook primary documents、attachments、appendices、service-like derived documents
- `canonical.md` / document metadata / `document-units.jsonl`
  只在 document-level cleaning 之后生成
- chunk/index
  只消费 document-level artifact，不直接消费 source-truth

## 核心原则

- source-truth 是 layout truth，不是 document truth
- source-truth 是 replay/rebuild 的唯一共享上游，不得返回 raw
- provider adapter 可以变化，但 source-truth contract 必须稳定
- handbook / curriculum 只能在 shared source-truth core 上做 collection-specific extension，不能各自复制一套核心逻辑
- 本轮禁止新增兼容层、双命名、双字段或“以后再删”的过渡代码

## 目标文档分层

- `docs/architecture/source-truth-normalization-contract.md`
  新增。冻结跨 collection 的 source-truth canonical contract
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
  只补引用与 phase-1 数据平面边界对齐
- `docs/architecture/student-handbook-ocr-normalization-strategy.md`
  收紧为 handbook-specific rules 与 projection semantics，不再重复 repo 级 source-truth contract
- `configs/ingestion/curriculum/curriculum_plan/README.md`
  收紧为 curriculum-specific extension，不再承担 repo 级 source-truth 定义
- `docs/reference/phase1-ingestion-retrieval-implementation-truth.md`
  在代码完成后更新为“当前实现已经删除哪些过渡态”

## 目标代码分层

重构完成后，`packages/ingestion-core` 中 OCR/source-truth 相关代码应固定为三层：

1. provider adapter
2. shared source-truth core builder
3. collection-specific projector / extension

其中：

- provider adapter 负责读取 PaddleOCR 当前输出形状并提取稳定 layout 能力边界
- shared core 负责统一 schema、字段、hint enrichment、table-shape inference、cross-page continuation inference
- collection-specific projector 只负责 handbook / curriculum 的差异字段与后续 split/document cleaning 需要的附加语义

禁止继续保留“每个 collection 一套半重复核心 normalization”的结构。

## Source-Truth Contract 目标形状

repo 级 source-truth canonical contract 至少应固定以下字段组：

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

仅当某个 collection 有明确 source-level 需求时，允许加 extension fields，但必须满足：

- 不能污染 core schema
- 不能引入 document/chunk 层语义
- 必须在 collection README 或 strategy doc 中明确说明

curriculum 当前保留的 `owner_row_id`、`relation_type`、`continuation_group_id` 属于这一类。

## 明确禁止的 source-truth 字段

本轮必须从 source-truth 层删除或禁止新增以下字段：

- `doc_id`
- `document_id`
- `version_id`
- `revision_track`
- `chunk_id`
- `clean_text`
- retrieval payload fields
- serving metadata
- registry-only metadata

如确有需要，应在 document-level cleaning 或 chunking 之后生成，而不是在 source-truth 提前写入。

## 命名与术语清债

本轮必须删除以下过渡命名：

- `RAW_INGESTION_ARTIFACT_MODE=provider_only`

长期正确命名应改为：

- `RAW_INGESTION_ARTIFACT_MODE=source_truth_only`

原因：

- 当前真正被后续复用的 canonical rebuild boundary 是 `source-truth`
- `provider_only` 会误导后续实现把 provider payload 当作长期上游

若现有测试、脚本、README、env 示例仍引用旧名，应统一迁移；不保留双命名兼容。

## 质量语义清债

当前 source-truth 中的 `semantic_confidence` 实际是规则分类置信度，不是最终语义质量置信度。

本轮建议：

- 代码字段改为 `classification_confidence`
- `classification_reason` 保持保守、可解释、可回归

如果由于迁移成本暂时不能立即改字段名，则至少必须：

- 在 repo 级 source-truth contract 文档中明确它的真实语义
- 把后续重命名列为本计划的强制后续任务，而不是开放性 TODO

本方案推荐直接完成字段重命名，不保留长期误导命名。

## 与 PaddleOCR 官方能力边界的对齐

PaddleOCR / PP-StructureV3 的官方长期能力边界是：

- 输出结构化 layout parsing 结果
- 恢复阅读顺序
- 输出 Markdown / table / page-level parsing result

因此本仓库对 PaddleOCR 的正确吸收方式应是：

- 把 PaddleOCR 视为 document layout provider
- 只依赖其稳定结构化能力边界
- 不把当前某个云 API 包装层的外围字段当成长期 contract

换句话说：

- `provider-response.jsonl` 原样保留
- source-truth adapter 只消费 provider payload 中稳定的 layout/page/block/table/read-order 子集
- 后续即使更换 PaddleOCR 部署方式，只要输出能力边界不变，下游 source-truth contract 不应被迫重写

## 实施任务

### Task 1: 新增 repo 级 source-truth contract 文档

**Files:**
- Create: `docs/architecture/source-truth-normalization-contract.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/phase1-ingestion-and-storage-architecture.md`

**Implementation:**
- 新增跨 collection 的 source-truth canonical contract 文档
- 写明 source-truth 的字段边界、禁止字段、命名边界、quality semantics
- 在 phase-1 architecture 中把 source-truth contract 引用固定下来
- 在 docs 索引中加入 canonical docs 列表

### Task 2: 收敛 shared source-truth core

**Files:**
- Modify: `packages/ingestion-core/src/campus_ingestion_core/source_truth_common.py`
- Modify: `packages/ingestion-core/src/campus_ingestion_core/handbook_provider_normalize.py`
- Modify: `packages/ingestion-core/src/campus_ingestion_core/curriculum_provider_normalize.py`

**Implementation:**
- 把 handbook 剩余的 source-truth core 逻辑迁入 shared helper
- handbook / curriculum 都改为“shared core + collection extension”结构
- 明确 shared core 负责：
  - text normalization
  - bbox normalization
  - repeat detection
  - parent heading hints
  - cross-page continuation
  - table shape inference

### Task 3: 删除 source-truth 前移语义

**Files:**
- Modify: `packages/ingestion-core/src/campus_ingestion_core/curriculum_provider_normalize.py`
- Modify: handbook/curriculum 相关 fixture 与 tests

**Implementation:**
- 从 source-truth 层删除 `clean_text`
- 从 source-truth 层删除 `chunk_id`
- 避免在 source-truth 中引入任何 document-unit / chunking 语义
- 保留 collection-specific linkage fields，但明确它们是 source-level extension

### Task 4: 完成 quality 字段重命名

**Files:**
- Modify: source-truth normalization code
- Modify: tests / fixtures / docs

**Implementation:**
- 将 `semantic_confidence` 重命名为 `classification_confidence`
- 保留 `classification_reason`
- 更新 handbook / curriculum docs 中对该字段的解释

### Task 5: 清除 ingestion mode 过渡命名

**Files:**
- Modify: ingestion runtime / config / docs / env examples / tests

**Implementation:**
- 将 `provider_only` 统一替换为 `source_truth_only`
- 删除旧命名兼容
- 更新 README、collection README、verification truth 与测试命名

### Task 6: 补 source-truth 质量门禁

**Files:**
- Create or modify: `tests/ingestion/...`
- Modify: relevant docs/verification artifacts

**Implementation:**
- 增加 source-truth 层专项验证，而不是只验证 object key 或 shape
- 最低要求覆盖：
  - heading classification
  - repeated header/footer/page-number detection
  - cross-page continuation hints
  - table block / header / continuation hints
  - handbook / curriculum 真实样本回归

### Task 7: 批量更新 docs / fixtures / verification truth

**Files:**
- Modify: handbook strategy doc
- Modify: curriculum README
- Modify: verification truth doc
- Modify: tests fixtures

**Implementation:**
- 移除旧术语与旧字段描述
- 将 docs 中 repo 级 contract 内容收回到新的 canonical architecture 文档
- 更新 fixture 使其反映最终 source-truth contract，而不是过渡形态

## 验收标准

完成后以下条件必须同时成立：

- handbook 与 curriculum 都建立在同一 shared source-truth core 上
- source-truth 层不再包含 `clean_text`、`chunk_id` 或其他 document/chunk 前移语义
- `provider_only` 术语已从代码、文档、测试中删除
- source-truth 字段语义已收敛，不再把规则分类置信度误写为最终语义置信度
- replay / rebuild 的 canonical boundary 仍固定为 `source-truth`
- repo 内已有 source-truth 专项质量门禁，而不只是 ingestion shape 测试
- docs 的职责分层恢复清晰：repo 级 contract、collection-specific strategy、implementation truth 各归其位

## 非目标

本计划不负责：

- 重写 retrieval core
- 冻结 rerank / HyDE / query rewrite 策略
- 将 source-truth 直接对接为 retrieval payload
- 增加新的 collection serving scope
- 替换已接受的 object storage / registry / Qdrant phase-1 架构

## 完成后的直接收益

- 新增 OCR collection 时，只需补 provider adapter / collection extension，而不是复制一整套 handbook 式核心逻辑
- 后续更换 PaddleOCR 部署方式，不会强迫重写 source-truth downstream
- source-truth 与 document truth 的边界恢复清晰，后续 chunking / retrieval 调参不再建立在混层数据上
- 过渡命名与前移字段被清除后，repo 的文档、测试和实现可以重新对齐到一个长期正确的心智模型
