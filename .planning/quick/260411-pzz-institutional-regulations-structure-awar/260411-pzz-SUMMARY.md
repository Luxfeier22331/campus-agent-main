# Quick Task 260411-pzz Summary

## Outcome

- 已为 `regulations/institutional_regulations` 落地 structure-aware short-fragment merge tuning。
- 修复后不再把 regulation block 当作无结构的孤立段落，而是显式保留：
  - target-side `anchor.section_path`
  - numeric item 的 `provision_label`
  - heading-only parent 与 child body 的结构化合并边界
- Cohort A rerun 结果已重新冻结：
  - `promotion_candidate_count = 1`
  - `promotion_manual_review_count = 10`
  - `prepared_candidate_count = 1`
  - `quality_posture = ready_for_target_materialization`
  - `short_body_chunk_count = 0`

## What Changed

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`
  - regulation projection 现在会为 target-side rows 生成真实 `anchor`
  - `section_path` 改为表达制度层级，而不是退化成 title-only metadata
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
  - `institutional_regulation_block` 进入 short-textual merge eligibility
  - 新增 collection-aware parent/child compatibility
  - 新增 aggregated-anchor 收口规则，避免合并后锚点重新坍塌回过宽父级
- `tests/ingestion/test_internal_notice_regulation_projection.py`
  - 新增 target-side structural anchor coverage
- `tests/ingestion/test_internal_notice_regulation_candidate_chunk_prep.py`
  - 新增 chunk-count reduction / aggregation / zero-short-body assertions

## Real Result

- Cohort A rerun 产物：
  - `cohort-a-target-chunk-acceptance-summary.json`
  - `cohort-a-target-chunk-acceptance.md`
  - `cohort-a-chunk-prep-rebuilt/validation-summary.json`
- 当前唯一 candidate `187233 / 中央民族大学采购工作管理办法`：
  - `unit_count = 16`
  - `chunk_count = 6`
  - `short_body_chunk_count = 0`
  - hard gate 全部通过

## External Rationale

- Azure AI Search 官方 chunking 指南建议先按标题、章节、段落等结构切，再用 token budget 做尺寸控制：
  - https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents
- Azure AI Search 官方 markdown indexing 文档明确支持按 markdown headers 形成 chunk 边界：
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-index-markdown-blobs
- Google Document AI Custom Splitter 官方也把“先切出逻辑文档/逻辑段，再下游处理”作为独立阶段：
  - https://docs.cloud.google.com/document-ai/docs/custom-splitter

## Remaining Work

- 当前 repo-local authenticated-notice 剩余重点已不再是 target chunk tuning。
- 下一步应转向 Cohort A 里 `10` 条 `manual_review_required` notice 的 promotion admission/routing review。
