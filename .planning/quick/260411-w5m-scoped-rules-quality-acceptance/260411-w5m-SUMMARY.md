# Quick Task 260411-w5m Summary

## Outcome

- 已完成 `regulations/scoped_rules` 的 repo-local、local-only chunk quality acceptance。
- 真实样本验收结果已冻结：
  - `scoped_rule_candidate_count = 10`
  - `materialized_document_count = 9`
  - `prepared_document_count = 9`
  - `total_unit_count = 305`
  - `total_chunk_count = 305`
  - `hard_gate_passed = true`
  - `short_body_chunk_count = 29`
- `short_body_chunk_count=29` 被记录为 soft observation，不构成当前 closeout blocker。
- 当前 operator rule 已固定：不得直接复用历史 `local-smoke/object-store` 根目录作为本轮 scoped-rules acceptance 的输出根，必须使用 isolated snapshot root。

## What Changed

- 新增并验证：
  - `tests/ingestion/test_internal_notice_scoped_rule_chunk_prep.py`
  - `tests/ingestion/test_prepare_scoped_rule_chunks_worker.py`
  - `.planning/quick/260411-w5m-scoped-rules-quality-acceptance/scoped_rules_local_chunk_acceptance.py`
  - `.planning/quick/260411-w5m-scoped-rules-quality-acceptance/scoped-rules-chunk-acceptance-summary.json`
  - `.planning/quick/260411-w5m-scoped-rules-quality-acceptance/scoped-rules-chunk-acceptance.md`
- 同步更新：
  - `configs/ingestion/regulations/scoped_rules/README.md`
  - `docs/plans/post-closeout-follow-up-execution-plan.md`
  - `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
  - `.planning/STATE.md`

## Key Finding

- 当前 repo-owned `materialize_internal_notice_scoped_rules -> prepare_scoped_rule_chunks` 路径已足够支撑 local-only acceptance。
- 本轮曾出现的误导性 drift 来自历史 local-smoke object-store 根目录被误用为输出根，而不是当前 materialization / chunk-prep 实现本身有缺陷。
- 这意味着 `scoped_rules` 的 repo-local 质量验收线现在已经关闭；后续如果再打开，只剩产品授权后的 query semantics，而不是继续怀疑当前 local-only prep path。

## External Rationale

- Databricks 的 retrieval-quality 指南把“先建立可重复评测，再优化检索与 chunking”列为前置条件，这支持我们先冻结 acceptance harness 和 hard gate，而不是继续凭感觉调分块。
  - <https://learn.microsoft.com/en-us/azure/databricks/generative-ai/vector-search-retrieval-quality>
- Azure AI Search 的 semantic chunking 文档强调先按文档结构切分，再用 chunk size 控制尺寸，这支持当前 lane-aware、structure-first 的 `scoped_rules` chunk-prep 口径。
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking>
- Azure AI Search 的 vector filter 文档强调 filter 依赖显式、可过滤的 metadata 字段，这支持把 `document_nature`、`source_notice_release_time`、`cycle_year` 这类字段在 acceptance 阶段就做 hard-check。
  - <https://learn.microsoft.com/en-us/azure/search/vector-search-filters>

## Boundary

- No embeddings
- No Qdrant write
- No alias publish
- No query-serving reopen
- No live portal dependency
