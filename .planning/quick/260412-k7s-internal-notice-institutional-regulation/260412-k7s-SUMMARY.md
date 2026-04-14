# Quick Task 260412-k7s Summary

**Description:** 完成 `internal_notice -> institutional_regulations` 的 local-only materialization 验收，并更新 docs/state 真相  
**Mode:** quick-full  
**Status:** completed

## Outcome

- 已在隔离 snapshot root 上完成 `internal_notice -> institutional_regulations` 的 local-only materialization acceptance。
- 当前 accepted cohort 的 `10` 条 regulation 已实际物化到 quick-task 自己的 target registry/object-store 输出中。
- `191176 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定` 已 promotion 并进入 `institutional_regulations`。
- `191177 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定` 不再是 residual `manual_review_required`；它当前作为 duplicate hold 保留在 `internal_notice`，并指向 `191176` 这条 primary target lineage。

## Materialized Titles

- `中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `药学院2021年硕博连读博士研究生招生实施细则`
- `历史文化学院2021年硕博连读博士研究生 招生实施细则`
- `中央民族大学采购工作管理办法`
- `生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `中央民族大学丰台校区就医管理办法（暂行）`
- `中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

## Artifacts

- [materialization-report.json](/home/reptilian/code/campus-agent/.planning/quick/260412-k7s-internal-notice-institutional-regulation/materialization-output/materialization-report.json)
- [materialization-summary.md](/home/reptilian/code/campus-agent/.planning/quick/260412-k7s-internal-notice-institutional-regulation/materialization-output/materialization-summary.md)
- [target-scope-records.json](/home/reptilian/code/campus-agent/.planning/quick/260412-k7s-internal-notice-institutional-regulation/materialization-output/target-scope-records.json)
- [object-store-write-manifest.json](/home/reptilian/code/campus-agent/.planning/quick/260412-k7s-internal-notice-institutional-regulation/materialization-output/object-store-write-manifest.json)

## What Changed

- 新增 quick-only harness：
  - [materialize_institutional_regulations_local_only.py](/home/reptilian/code/campus-agent/.planning/quick/260412-k7s-internal-notice-institutional-regulation/materialize_institutional_regulations_local_only.py)
- 补齐了 parent notice promotion 的两个关键修复：
  - 文号行剥离后继续 wrapper-leading 清洗
  - parent notice 使用 `regulation_title_normalized + promotion_body` 的语义去重，不再只看原始 `content_hash`
- 更新了 promotion runbook / acceptance reference / manual-review reference / planning truth：
  - [internal-notice-policy-regulation-promotion-runbook.md](/home/reptilian/code/campus-agent/docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md)
  - [institutional-regulations-promotion-quality-acceptance.md](/home/reptilian/code/campus-agent/docs/reference/institutional-regulations-promotion-quality-acceptance.md)
  - [internal-notice-manual-review-collection-strategy.md](/home/reptilian/code/campus-agent/docs/reference/internal-notice-manual-review-collection-strategy.md)
  - [post-closeout-follow-up-execution-plan.md](/home/reptilian/code/campus-agent/docs/plans/post-closeout-follow-up-execution-plan.md)
  - [STATE.md](/home/reptilian/code/campus-agent/.planning/STATE.md)
- 顺手修复了一个 repo blocker：
  - [raw_ingestion.py](/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py)
  - `PaddleOcrLayoutParsingServiceClient.parse_file()` 中的换行字面量断裂导致整个包导入失败，现已修正

## Boundary

- no auth-dependent collection
- no replay
- no OCR compare
- no embeddings / Qdrant writes
- no release / alias publish
