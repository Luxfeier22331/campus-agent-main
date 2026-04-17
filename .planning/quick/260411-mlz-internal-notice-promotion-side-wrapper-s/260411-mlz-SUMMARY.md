# Quick Task 260411-mlz Summary

## Outcome

- 已为 `中央民族大学采购工作管理办法` 落成 promotion-side `wrapper stripping / regulation-body cleanup` helper，并接入 `internal_notice` promotion 逻辑。
- 这次实现没有改写 `internal_notice` source-triage canonical markdown；剥离逻辑只在 promotion-side helper 中生效。
- 真实样本 `187233` 的 cleanup preview 已落盘，新的 local manifest 也已验证通过。

## What Changed

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
  - 新增 `extract_internal_notice_parent_regulation_body_preview(...)`
  - parent notice 的 promotion 现在基于 cleaned body 做 `wrapper_semantics_removed` 与 `standalone_body_quality_passed` 判断
- `tests/ingestion/test_internal_notice_regulation_promotion.py`
  - 新增 wrapper stripping helper 测试
  - 新增 parent notice candidate manifest 测试

## Real Sample Result

对 `关于修订《中央民族大学采购工作管理办法》的通知`：

- 被剥离的 leading lines：
  - `学校各单位、各部门：`
  - `...现将有关事项通知如下：`
- 被剥离的 trailing lines：
  - `特此通知。`
  - `附件：采购意向公开参考文本`
  - `资产管理处（招标采购中心）`
  - `2021年2月28日`
- 清洗后仍保留结构化制度性正文：
  - `一、主要修订内容`
  - `二、采购注意事项`
  - `（一）采购意向公示要求`
  - `（二）校内集中采购项目采购流程`
  - `（三）规范分散采购`

新的 real-sample promotion report 现在明确给出：

- `action = promote_candidate`
- `promotion_class = formal_regulation`
- `quality_gates_passed` 包含：
  - `wrapper_semantics_removed`
  - `standalone_body_quality_passed`
  - `canonical_text_available`
  - `provenance_complete`
  - `duplicate_check_passed`

## Why This Matters

这轮推进把 `internal_notice` 从“知道 187233 是 candidate，但解释不清 wrapper 怎么剥”推进到了：

- 有可复用 helper
- 有真实样本 preview
- 有 manifest 级 gate
- 有测试保护

也就是说，`internal_notice` 现在可以继续沿 promotion-side cleanup 前进，而不需要先碰 release/index。

## Boundary

- No Postgres writes
- No Qdrant / embeddings
- No release / alias
- No target collection write
- No OCR mode change

## Artifacts

- `187233-wrapper-cleanup-preview.json`
- `187233-cleaned-body.md`
- `187233-promotion-report.json`
- `pilot_187233_wrapper_cleanup.py`

## Next Step

下一步最合理的是：

- 把 `source_notice_release_time` 补齐到 `中央民族大学采购工作管理办法` 的 promotion metadata；
- 在不触发 collection write 的前提下，把 promotion-side cleaned body 进一步固化成 repo-tracked candidate artifact contract。
