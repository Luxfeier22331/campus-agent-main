---
phase: "I"
name: "OOXML Structured Normalization Contract"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase I Research

## Goal Fit

这份研究只回答 `Phase I` 的 implementation question：

- 如何把 modern OOXML（`.docx/.xlsx`）从当前 source-faithful `ExtractionOutcome.text_blocks`，推进到 repo-owned post-extraction structured normalization contract

它不重开：

- legacy Office conversion runtime
- PDF / image OCR provider routing
- `official_web` linked-file adoption
- `authenticated_notice file_release`
- regulation downstream
- query-serving reopening

## Current Gap

当前 shared file asset loader 已经证明：

- `.doc/.xls -> .docx/.xlsx` conversion seam 可用
- `.docx/.xlsx` deterministic extraction 可用
- 真实对象存储样本已经通过 OOXML extraction 验证

但 repo 代码真相仍停在：

- `packages/ingestion-core/src/campus_ingestion_core/file_asset_ooxml.py`
  - `extract_docx_text_blocks(...)`
  - `extract_xlsx_text_blocks(...)`
  - 输出只有 `ExtractionOutcome.text_blocks`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_contract.py`
  - 共享 contract 只冻结到 `NormalizationOutcome / ExtractionOutcome / TerminalOutcome`
  - 没有 repo-owned structured normalization outcome
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
  - 对 `text_extractable` attachment 直接把 `text_blocks` 渲染成 markdown
  - 再把每个 block 直接变成 `attachment_body` document units
  - provider payload 也只持久化 `FileAssetExtractionRecord`

因此当前 OOXML 路径的真实问题不是“不能提取”，而是：

- 下游 retrieval / chunking / import 仍要从扁平 `text_blocks` 猜测 heading / table / sheet / continuation-row semantics
- `xlsx` 续行、header promotion、merged-cell / repeated label 语义没有 repo-owned downstream contract
- `.docx` 的 heading / list / table 结构只作为隐含文本存在，不是结构化 truth

## Evidence

真实 evidence 已经固定：

- `.tmp/phase-h-libreoffice-runtime-productization-recheck/OOXML-EXTRACTION-SUMMARY.md`
- `.tmp/phase-h-libreoffice-runtime-productization-recheck/ooxml-extraction-report.json`
- `.tmp/phase-h-libreoffice-runtime-productization-recheck/OOXML-QUALITY-VALIDATION.md`

这些证据表明：

- `docx` 样本：段落 /表格覆盖率已经达到 source-faithful 基线
- `xlsx` 样本：工作表行覆盖率已经达到 source-faithful 基线
- `xlsx` 中出现的续行首列空值并不是 extractor 漏值，而是转化后的 OOXML 源表本身如此

所以 Phase I 的责任不是“修 extraction bug”，而是“把 source-faithful extraction 之后的结构语义显式化”。

## Existing Repo Patterns

### Pattern 1: Generic `layout_elements_bytes` Already Exists

`DocumentImportInput` 已经有通用 `layout_elements_bytes` 字段。

这意味着：

- Phase I 不需要新造第二条 artifact lane
- OOXML structured normalization 最自然的落点，是复用 repo 已存在的 generic `layout_elements` import seam

### Pattern 2: OCR / PDF Already Uses Two-Stage Canonicalization

PDF / OCR 当前不是直接消费 provider raw text，而是：

- provider result
- canonical provider payload
- collection-specific layout normalization
- `layout_elements_bytes`

代表实现：

- `handbook_provider_normalize.py`
- `curriculum_provider_normalize.py`
- `authenticated_notice_attachment_ocr.py`

这说明 repo 已经接受：

- “source-faithful parse” 与 “downstream structural normalization” 是两层不同职责

### Pattern 3: Shared Structural Helpers Already Exist

`source_truth_common.py` 已经提供：

- `normalize_text(...)`
- `infer_list_level_hint(...)`
- `infer_table_header_rows(...)`
- `infer_table_row_count(...)`
- `infer_table_column_count(...)`
- `detect_merged_cells(...)`
- `serialize_layout_rows(...)`

这些 helper 正适合作为 OOXML normalizer 的 shared substrate，而不是从零再发明一套表格语义 helper。

## Recommended Contract Direction

### Recommendation 1: Keep Deterministic Extraction Separate

不要把 Phase I 做成“让 extractor 直接变复杂”。

推荐边界：

- extraction
  - 继续负责 source-faithful deterministic parse
  - 继续保留 debug / regression-friendly `text_blocks`
- structured normalization
  - 新增 repo-owned second-stage normalization
  - 输出 retrieval-grade structural artifact

这样可以保持：

- regression evidence 仍能直接比较 extraction 结果
- normalization 失败不会伪装成 extraction 成功

### Recommendation 2: Reuse `layout_elements_bytes` As Canonical Downstream Artifact

最佳收口方式不是定义一个 OOXML-only 私有 schema 文件类型，而是复用已有 generic row-oriented artifact：

- `layout_elements_bytes`

理由：

- object store / registry / import path 已有通用存放位
- OCR / PDF lane 已经在用同一 seam
- 可以减少 consumer migration 成本

### Recommendation 3: Row-Oriented Structured Normalization Is Better Than a Deep Nested Object

虽然 `.xlsx` 本体天然是 workbook/sheet/row/cell 树，但 repo 当前下游消费模式更适合 JSONL row artifact。

推荐方向：

- `docx`
  - 一行一个 structural block
  - `row_type`: `title` / `heading` / `paragraph` / `list_item` / `table`
  - `heading_level`
  - `list_level_hint`
  - `table_cells` for tables
- `xlsx`
  - 一行一个 worksheet structural row
  - 保留 `sheet_name`
  - `row_type`: `sheet_title` / `table_header` / `table_row` / `note` 等
  - `table_cells` 用 cell dicts 或 normalized matrix 表达
  - cell-level metadata 包括：
    - `row`
    - `col`
    - `text`
    - `formula`
    - `displayed_value`
    - `is_forward_filled`
    - `is_merged_continuation`

这样既能表达 workbook/sheet/row/cell 语义，又能复用 repo 现有 `layout_elements` 消费方式。

### Recommendation 4: Deterministic Forward-Fill Should Be Explicit And Flagged

对 `xlsx` 续行，推荐：

- 允许 deterministic forward-fill
- 但必须显式标记来源不是原单元格值

例如：

- `is_forward_filled: true`
- `forward_fill_source_col: 1`

这样可以提升 retrieval-grade 质量，同时不伪装成 source-faithful extraction。

### Recommendation 5: Migration Should Be Additive First

Phase I 不应第一步就删除 `text_blocks`。

推荐迁移顺序：

1. 新增 OOXML structured normalizer
2. 新增 `layout_elements_bytes` artifact
3. 让至少一个 shared consumer 优先使用 structured artifact
4. 保留 `text_blocks` 作为 compatibility / diagnostics
5. 后续再决定是否降级其 forward-truth 地位

## Recommended Consumer Cut

最合适的首个 consumer 仍是：

- `authenticated_notice_source_projections.py`

因为它当前正是把 `text_blocks` 直接 materialize 成 markdown / document units 的典型路径。

Phase I 里应至少做到：

- 对 `text_extractable` attachment，如果存在 OOXML normalized layout rows：
  - canonical markdown 优先从 structured rows 生成
  - document units 优先从 structured rows 生成
  - `layout_elements_bytes` 一并持久化

这能证明 Phase I 不只是“定义 schema”，而是真的把 shared downstream truth 往前推进。

## Risks To Avoid

- 不要把 collection-specific cleanup 反塞进 OOXML extractor
- 不要把 handbook/curriculum 的业务 heading 规则直接硬套到所有 OOXML
- 不要为了省事直接用 OCR layout schema 冒充 OOXML schema，而忽略 workbook/sheet/cell provenance
- 不要把 source-faithful extraction 删掉，导致后续无法区分“解析结果”与“归一化结果”

## Recommendation Summary

Phase I 最合理的实现策略是：

- keep:
  - current deterministic OOXML extraction
  - current `ExtractionOutcome.text_blocks`
- add:
  - repo-owned OOXML structured normalizer
  - generic `layout_elements_bytes` artifact for OOXML
  - explicit downstream consumer migration for at least `authenticated_notice`
- verify:
  - real `.docx/.xlsx`
  - legacy Office converted OOXML
  - source-faithful extraction preserved
  - structured normalization materially improves downstream semantics
