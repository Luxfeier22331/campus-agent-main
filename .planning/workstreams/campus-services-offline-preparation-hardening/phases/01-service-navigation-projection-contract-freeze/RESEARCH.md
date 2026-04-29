---
phase: "01"
artifact: "research"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 01 Research

## Purpose

把 Phase 01 需要冻结的 contract 建立在两类事实之上：

- repo 当前已经存在的 selector、source-truth、artifact-builder pattern
- 官方文档确认过的最小外部能力：页范围 PDF subset 与结构化 document OCR

## Official References Consulted

- `pypdf` user guide:
  - https://pypdf.readthedocs.io/en/latest/user/merging-pdfs.html
- PaddleOCR `PP-StructureV3` pipeline usage:
  - https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PP-StructureV3.html

## Repo Pattern Readings

- `configs/ingestion/regulations/student_rules/source-projections.v1.json`
- `docs/reference/student-handbook-normalization-strategy.md`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_ocr.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`

## Standard Stack

- `pypdf`
  - 官方文档直接支持 `PdfWriter.append(..., pages=(start, end))` 这种页范围复制方式，适合作为 `Phase 02` 的最小 PDF subset 依赖。
  - 它比手写 PDF 字节裁切更稳，也不要求引入额外的外部服务。
- 现有 repo OCR runtime
  - 当前仓库已经有 `OnlineOcrClient`、`parse_online_ocr_bytes(...)` 和 provider payload canonicalization，不需要为这条线再发明第二套 OCR 调用约定。
- 现有 artifact-builder pattern
  - `build_authenticated_notice_ocr_attachment_artifacts(...)` 已经证明“provider-response -> layout-elements -> document-units -> markdown body”这条路径可复用。

## Architecture Patterns

- selector-first, not query-first
  - source-truth selector 已经固定为 `source_title + source_handbook_section + source_page_start/source_page_end`，后续 materialization 必须消费这个固定 selector，而不是开放新的查询面。
- projection-local bounded materialization
  - bounded OCR 应落在 handbook-derived target projection 这一层，不回写新的 handbook source-truth family，也不返回 raw-wide replay。
- external 1-based, internal adapter conversion
  - repo contract 已经把 handbook 页码固定成 1-based。若用 `pypdf`，实现层必须把 `252-255` 这类闭区间显式转换为底层零基切片，避免 operator 看见新的页码语义。
- OCR provenance stays provider-shaped
  - 最小可审计产物不该只有 `canonical.md`；仍应保留 bounded `provider-response.jsonl`，然后再生成 `layout-elements.jsonl` 与 `document-units.jsonl`。
- fail-close on body absence
  - image-heavy 文档不能因为标题或边角文本存在就被视为 materialized success；必须对正文可消费性单独设 gate。

## Don't Hand-Roll

- 不要手写 PDF 页字节裁切逻辑；直接用 `pypdf` 页范围复制。
- 不要新造一套 service navigation OCR payload schema；继续复用 repo 已有 provider payload 形状和 `source_truth_common`/artifact-builder 约定。
- 不要把 `service_catalog` 扩成通用 OCR 查询器。
- 不要在 canonical source truth 已存在时回退 whole-handbook raw replay。
- 不要接受 title-only 成功判定。

## Common Pitfalls

- off-by-one
  - selector 页码是 1-based，`pypdf` 页范围 API 使用零基索引；这是最容易在 bounded capture 中放大范围或漏页的点。
- image-only false positive
  - 当前 handbook cleanup 会跳过无文本非表格 row，所以若不单独设 gate，很容易得到“标题存在、正文缺失”的伪成功结果。
- provenance drift
  - 如果只持久化 `canonical.md` / `document-units.jsonl` 而不保留 bounded `provider-response.jsonl`，后续 targeted verification 会失去 OCR provenance。
- dependency drift
  - `packages/ingestion-core` 当前未声明 `pypdf`；若 Phase 02 采用它，需要先显式补依赖，而不是把它藏在 operator 机器环境里。

## Code Examples

- `pypdf` 官方示例直接展示了页范围复制：
  - `writer.append(source_file_name, (0, 10))`
  - `merger.append(fileobj=input1, pages=(0, 3))`
- repo 内最接近的 OCR artifact pattern：
  - `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_ocr.py`
- repo 内现有 selector/fallback pattern：
  - `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
  - `_match_projection_source_document_from_selector(...)`

## Conclusions For Phase 01

1. 当前真正缺的是 projection-local bounded materialization contract，不是 selector contract。
2. `Phase 02` 的最小技术栈可以收敛为：`pypdf` 做页范围 subset，复用现有 OCR client，复用现有 artifact-builder pattern。
3. 最关键的 contract 决策是：
   - selector 继续保持 1-based 闭区间
   - subset PDF 只是执行输入，不升级成新的 source-truth family
   - bounded `provider-response.jsonl` 应保留为 target-local provenance
   - 无正文时 fail-close
4. 这条方案与 repo 当前最佳实践一致：source-truth full capture 不变，bounded hardening 只发生在 downstream projection/offline-preparation 层。
