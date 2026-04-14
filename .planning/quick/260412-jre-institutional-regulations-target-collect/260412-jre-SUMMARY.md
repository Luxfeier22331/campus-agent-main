# Quick Task 260412-jre Summary

**Description:** 推进 `institutional_regulations` target collection 的 local-only chunk preparation 与 validation acceptance  
**Mode:** quick-full  
**Status:** completed

## Outcome

- 已基于当前 repo-head 重新执行 Cohort A 的 local-only target acceptance rerun，并把 fresh artifacts 独立落到本 quick task 目录。
- 刷新后，Cohort A 已不再是旧的 `1 promote / 10 manual review`，也不再保留 residual manual-review：
  - `promotion_candidate_count = 10`
  - `promotion_manual_review_count = 0`
  - `promotion_hold_count = 1`
  - `prepared_candidate_count = 10`
  - `short_body_chunk_count = 0`
  - `quality_posture = ready_for_target_materialization`
- `191176` 已作为 primary candidate 进入 target preparation。
- `191177` 当前是 duplicate hold，指向 `191176`；它不再进入 manual-review lane。

## Accepted Target Candidates

本轮 rerun 进入 target chunk-prep 并通过 hard gate 的 `10` 条 regulation 包括：

- `中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `药学院2021年硕博连读博士研究生招生实施细则`
- `历史文化学院2021年硕博连读博士研究生招生实施细则`
- `中央民族大学采购工作管理办法`
- `生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `中央民族大学丰台校区就医管理办法（暂行）`
- `中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

## What Changed

- 新增 fresh rerun evidence：
  - [rerun-output/cohort-a-target-chunk-acceptance-summary.json](/home/reptilian/code/campus-agent/.planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/cohort-a-target-chunk-acceptance-summary.json)
  - [rerun-output/cohort-a-target-chunk-acceptance.md](/home/reptilian/code/campus-agent/.planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/cohort-a-target-chunk-acceptance.md)
- 刷新了 follow-up truth：
  - [post-closeout-follow-up-execution-plan.md](/home/reptilian/code/campus-agent/docs/plans/post-closeout-follow-up-execution-plan.md)
  - [STATE.md](/home/reptilian/code/campus-agent/.planning/STATE.md)

## New Next Step

这条离线 regulation 线当前不再需要继续重复 target chunk tuning。

新的 next step 已收窄为：

- 把这 `10` 条 `ready_for_target_materialization` candidates 继续推进到 local-only target materialization acceptance
- 保留 `191177` 作为 duplicate hold source truth，不生成第二份 regulation target

## Boundary

- No portal auth
- No replay
- No OCR compare
- No embeddings
- No Qdrant writes
- No alias publish
