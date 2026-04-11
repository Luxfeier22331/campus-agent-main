# Quick Task 260411-rho Summary

## Outcome

- 已修正 `institutional_regulations` promotion adjudication 的粗粒度规则。
- repo 现在明确冻结：
  - `document age` 不是 standalone exclusion signal
  - `暂行/试行` 不是自动 manual-review signal
  - manual-review 分流必须回到 annual-cycle/program-specific 与 explicit temporary-operation semantics

## What Changed

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
  - 拆出 `draft`、`annual_cycle_or_program_rule`、`operational_scheme`、`time_bound_operational_rule` 四类判据
  - 去掉把 `暂行/试行` 直接当成 negative signal 的粗规则
- `tests/ingestion/test_internal_notice_regulation_promotion.py`
  - 新增“provisional title 但正文稳定”可进入 candidate 的回归覆盖
  - 更新 `191705` / 暑假规则 / 招生细则 的 reason 断言
- `configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json`
  - 新增 `document_nature_taxonomy` 与 `force_status_taxonomy`
  - 明确 `document age` 与 `暂行/试行` 的非自动排除规则
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
  - 补充 freshness/metadata 官方依据
  - 修正 promotion guardrail 文字

## Cohort A Result

- rerun 之后，Cohort A 结果仍保持稳定：
  - `promotion_candidate_count = 1`
  - `promotion_manual_review_count = 10`
  - `quality_posture = ready_for_target_materialization`
  - `short_body_chunk_count = 0`
- 唯一 candidate 仍是 `187233`
- 变化发生在 manual-review 的解释层，而不是把 cohort 结果无控制放大

## Adjudication Freeze

- `186957 / 186977 / 187004 / 196411 / 351907 / 353963 / 354006`
  - 冻结为 `annual_cycle_rule`
- `191176 / 191177 / 191705`
  - 冻结为 `time_bound_operational_rule`
- `191705` 继续 manual，但依据改为正文里的 `临时医疗点 / 正式运营前 / 正式运营后取消`，而不是 `暂行` 标题词

## Artifacts

- `manual-review-adjudication.json`
- `manual-review-adjudication.md`
- `cohort-a-target-chunk-acceptance-summary.json`
- `cohort-a-target-chunk-acceptance.md`
