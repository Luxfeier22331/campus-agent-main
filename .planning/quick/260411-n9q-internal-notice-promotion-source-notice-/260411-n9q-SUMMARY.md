# Quick Task 260411-n9q Summary

## Outcome

- 已修复 `internal_notice` promotion 链路中 `source_notice_release_time` 的透传缺口。
- `authenticated_notice` source-truth inventory 的 `parent_snapshot` 现在会保留 `notice_release_time`。
- promotion 侧现在优先读取 `parent_snapshot.notice_release_time`，不再只依赖 `record.published_date`。
- 真实样本 `187233 / 关于修订《中央民族大学采购工作管理办法》的通知` 已完成 rebuilt inventory + promotion 本地重算，`missing_required_metadata` 已清空。

## What Changed

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_inventory.py`
  - inventory parent snapshot 新增 `notice_release_time`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
  - `_extract_source_notice_release_time(...)` 现在优先读取 source-truth inventory snapshot 中的 `notice_release_time`
- `tests/ingestion/test_internal_notice_regulation_promotion.py`
  - 新增 promotion manifest 优先使用 inventory `notice_release_time` 的测试
- `tests/ingestion/test_authenticated_notice_import.py`
  - 新增 import/rebuild 后 inventory snapshot 保留 `notice_release_time` 的断言

## Real Sample Verification

对 `187233` 的 local-smoke 真实样本重算结果：

- rebuilt inventory entry:
  - `parent_snapshot.notice_release_time = 2021-02-28 16:09`
- rebuilt promotion report:
  - `source_notice_release_time = 2021-02-28 16:09`
  - `missing_required_metadata = []`
  - `action = promote_candidate`
  - `promotion_class = formal_regulation`

验证产物已落盘：

- `187233-rebuilt-inventory-entry.json`
- `187233-rebuilt-promotion-report.json`

## External Rationale

这次修复遵循的是“父级 provenance / metadata 需要显式复制到后续消费单元”的保守做法，而不是让后续阶段再去猜测或回填：

- Azure AI Search 的 index projections 明确要求把父文档 metadata 映射到 chunk 文档，避免切分后丢失上游上下文与过滤字段：
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections>
- Google Cloud Document AI 的 splitter 文档也把“先判定文档/页面归属，再进入后续处理”作为正式能力边界，说明 classification / metadata 不能在后置链路里隐式猜测：
  - <https://cloud.google.com/document-ai/docs/custom-splitter>

对我们当前场景，这意味着：

- `notice_release_time` 应作为 source-truth provenance 被 inventory 显式保留
- promotion 只消费显式 metadata，不把 `published_date` 当作唯一替代字段

## Boundary

- No Postgres writes
- No target collection write
- No release / alias
- No embedding / Qdrant
- No OCR mode change
