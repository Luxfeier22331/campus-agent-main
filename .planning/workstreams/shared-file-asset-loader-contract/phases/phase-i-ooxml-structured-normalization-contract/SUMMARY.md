---
phase: "I"
phase_name: "OOXML Structured Normalization Contract"
status: completed
created: 2026-04-20
updated: 2026-04-20
---

# Phase I Summary

## What Landed

- `packages/ingestion-core/src/campus_ingestion_core/file_asset_ooxml.py`
  - 新增 repo-owned `build_ooxml_layout_elements_bytes(...)`
  - `docx` 现会产出 row-oriented heading / paragraph / list_item / table layout rows
  - 对没有 Word heading style 的真实文档增加 fail-close heading heuristics：标题与短 section-like 行不再全部降级成 plain paragraph
  - `xlsx` continuation rows 现只对 leading repeated cells 做 deterministic forward-fill，不再把中间空列误补成前一行值
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_text_extractable.py`
  - 新增 shared dispatcher `build_text_extractable_layout_elements_bytes(...)`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
  - text-extractable attachment 现在会持久化 `layout_elements_bytes`
  - 如果 structured rows 可用，canonical markdown 与 document units 优先消费 structured rows，而不是继续只依赖 `ExtractionOutcome.text_blocks`
- `scripts/verify_ooxml_structured_normalization.py`
  - 新增 repo-owned real-sample verification command
  - 直接复用 `.tmp/phase-h-libreoffice-runtime-productization-recheck/samples/manifest.json` 中的真实 authenticated_notice 样本
  - 输出新的 Phase I evidence bundle 到 `.tmp/phase-i-ooxml-structured-normalization/`

## Verification

- `uv run --all-packages python -m unittest tests.test_verify_ooxml_structured_normalization tests.ingestion.test_file_asset_substrate tests.ingestion.test_authenticated_notice_source_projections tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker`
  - `69 tests OK`
- `uv run --all-packages python -m scripts.verify_ooxml_structured_normalization --json`
  - real-sample verdict: `pass`
  - evidence dir: `.tmp/phase-i-ooxml-structured-normalization/`

## Real-Sample Evidence

- DOCX sample:
  - source object key:
    `authenticated_notice_portal/attachment-014d8b2665dc/2021/sha256/014d8b2665dc366392b29d4823f0245b067cd5d9adea614a832621e005d07a48/capture/2021年中央民族大学新任辅导员专题网络培训教学计划.doc`
  - extraction still preserved `46` source-faithful text blocks
  - structured normalization now yields `46` layout rows: `21 heading`, `19 paragraph`, `5 list_item`, `1 table`
- XLS sample:
  - source object key:
    `authenticated_notice_portal/attachment-0040899867e0/2020/sha256/0040899867e08c39c9388b4647989c5d34c88da6815cf03a23d6e69b6f30519a/capture/19-20-2公外期末考试安排表20.9.3.xls`
  - extraction still preserved the workbook as `1` source-faithful text block
  - structured normalization now yields `2 heading + 1 table`
  - continuation handling now produces `24` forward-filled cells, and all are validated as leading-prefix fills rather than arbitrary interior fills

## Closeout

- `Phase I` exit rule 已满足：
  - shared OOXML structured normalization contract 已进入代码真相
  - `.docx/.xlsx` 已有 repo-owned normalized structural artifacts
  - `authenticated_notice` 已成为首条 preferential consumer path
  - 真实样本 evidence 已证明 structured normalization 改善 downstream semantics，同时未回归 source-faithful extraction
- 因此这条 workstream 现已 `9/9 phases complete`
