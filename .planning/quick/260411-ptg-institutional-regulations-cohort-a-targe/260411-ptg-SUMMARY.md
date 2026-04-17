# Quick Task 260411-ptg Summary

## Outcome

- 已把 `institutional_regulations` 的 Cohort A target-side acceptance 从单文档 pilot 推进成 batch-level、repo-local、可重跑的 quick task。
- 新 harness 会按固定顺序执行：
  - rebuilt inventory
  - promotion candidate export
  - target chunk prep
  - acceptance summary
- 真实结果已经冻结：
  - Cohort A notice count = `11`
  - rebuilt inventory notice count = `11`
  - promotion candidate count = `1`
  - promotion manual review count = `10`
  - exported candidate count = `1`
  - prepared candidate count = `1`
  - 当前唯一进入 target chunk prep 的是 `187233`
  - `187233` target hard gate 通过，但 `short_body_chunk_count = 7`

## What Changed

- [cohort_a_target_chunk_acceptance.py](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py)
  - 新增 local-only batch acceptance harness
- [cohort-a-target-chunk-acceptance-summary.json](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance-summary.json)
  - 固定 machine-readable acceptance truth
- [cohort-a-target-chunk-acceptance.md](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance.md)
  - 固定 operator-readable acceptance结论
- [post-closeout-follow-up-execution-plan.md](/home/reptilian/code/campus-agent/docs/plans/post-closeout-follow-up-execution-plan.md)
  - 把 authenticated-notice 下一步从笼统的 target chunk acceptance 收窄为：
  - `10` 条 manual-review notice 的 promotion admission/routing review
  - `187233` 的 short-fragment tuning review
- [STATE.md](/home/reptilian/code/campus-agent/.planning/STATE.md)
  - 新增 quick task `260411-ptg`
  - 更新 authenticated-notice next action

## Key Finding

这次 quick task 最重要的结论不是 chunking，而是 admission boundary：

- Cohort A 虽然有 `11` 条 body-text 样本，但当前 promotion routing 只把 `187233` 判成 `promote_candidate`
- 其余 `10` 条全部落在 `manual_promotion_review`
- 主要原因集中在：
  - `revision_signal` 缺失
  - `effective_date` 缺失
  - `issuing_org` 缺失
  - `draft_or_operational_signal_detected`
  - `time_bound_or_operational_signal_detected`
  - `wrapper_semantics_still_present`

所以当前更优先的后续工作不是“假设 11 条都已进入 target chunk prep 再做 merge tuning”，而是先 review promotion admission/routing truth。

## External Rationale

这次推进符合官方文档的三条共同原则：

- Azure Databricks retrieval-quality 指南明确说，没有可复现 evaluation 就不要优化；先测量，再改路由/检索/分块。
  - <https://learn.microsoft.com/en-us/azure/databricks/generative-ai/vector-search-retrieval-quality>
- Azure AI Search index projections 推荐在 child chunk 上重复 parent metadata，这支持我们先 rebuild inventory，再做 candidate export / target chunk prep，而不是丢掉父级上下文。
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections>
- Azure AI Search chunking 指南强调语义边界和标题/段落上下文，这支持把 `short_body_chunk_count=7` 视为后续 tuning review 信号，而不是直接忽略。
  - <https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents>

## Boundary

- No Postgres writes
- No Qdrant access
- No embeddings
- No release manifest
- No alias publish
- No live portal
