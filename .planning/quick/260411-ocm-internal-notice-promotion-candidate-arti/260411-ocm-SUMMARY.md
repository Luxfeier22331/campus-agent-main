# Quick Task 260411-ocm Summary

## Outcome

- 已为 `internal_notice` promotion 落成 repo-native `candidate artifact contract`。
- 这层 contract 固定把 `promote_candidate` 结果导出为 local-only artifact，而不是直接写入 `regulations/*`。
- 真实样本 `187233 / 关于修订《中央民族大学采购工作管理办法》的通知` 已完成 candidate export 验收。

## What Changed

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
  - 新增 candidate artifact dataclass
  - 新增 `build_internal_notice_regulation_candidate_artifact_manifest(...)`
  - 新增 `export_internal_notice_regulation_candidate_artifacts(...)`
  - candidate markdown 现在固定写出 promotion-side cleaned body + source provenance front matter
- `apps/ingestion-worker/src/campus_ingestion_worker/export_internal_notice_regulation_candidate_artifacts.py`
  - 新增 local-only worker CLI
- `tests/ingestion/test_internal_notice_regulation_promotion.py`
  - 新增 candidate artifact export contract 测试
- `tests/ingestion/test_export_internal_notice_regulation_candidate_artifacts_worker.py`
  - 新增 worker CLI local snapshot 测试
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
  - 新增 local-only candidate artifact contract 设计记录

## Contract Shape

第一版 local-only candidate export 固定导出：

- `promotion-candidate-manifest.json`
- `candidate-documents.jsonl`
- `candidates/<slug>--<candidate_id>/canonical.md`

其中 candidate markdown 固定保留：

- `candidate_id`
- `source_document_id`
- `source_kind`
- `promotion_class`
- `source_notice_release_time`
- `source_parent_document_id`
- `source_attachment_ref_id`
- `source_attachment_sha256`
- `issuing_org`
- `effective_date`
- `revision_signal`

正文固定为：

- `# regulation_title_normalized`
- promotion-side cleaned regulation body

## Real Sample Result

对 `187233` 的真实 local-smoke 样本：

- `exported_candidate_count = 1`
- `candidate_id = 0425aed278c86fda`
- `source_notice_release_time = 2021-02-28 16:09`
- 导出的 candidate markdown 路径：
  - `candidates/中央民族大学采购工作管理办法--0425aed278c86fda/canonical.md`

对应产物已落盘：

- `promotion-candidate-manifest.json`
- `candidate-documents.jsonl`
- `187233-candidate-document.json`
- `187233-candidate-export-summary.json`

## External Rationale

这一步采用的是“先把父级 metadata 和 cleaned body 显式映射成后续消费单元，再进入 chunk-prep”的保守路线，依据来自官方文档：

- Azure AI Search index projections：
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections>
- Azure AI Search chunking guidance：
  - <https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents>
- Google Cloud Document AI custom splitter：
  - <https://cloud.google.com/document-ai/docs/custom-splitter>

对我们当前场景的直接含义是：

- promotion 不能只停在 manifest judgement
- cleaned body 不能只作为一次性内存结果存在
- 后续 chunk-prep 应消费 candidate artifact，而不是继续直接读 source-triage notice

## Boundary

- No Postgres writes
- No target collection write
- No release / alias
- No embedding / Qdrant
- No OCR mode change
