---
doc_type: reference
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-04-05
updated: 2026-04-20
---
# Official Web Fresh News Eval Baseline

## 目的

本文记录 `official_web/fresh_news` seed set 的离线评估基线：

- repo-tracked seed denominator 是什么
- retrieval seed validation 的 accepted baseline 是什么
- 这组 baseline 的适用边界是什么
- 后续 rerun 何时应更新本文

边界：

- 这不是 `fresh_news` 默认 query-serving 已开放的证明
- 这不是 freshness-sensitive routing / policy 已闭合的证明
- 本文不长期暴露单次 `.tmp` artifact 或运行面 workaround 路径

## Baseline Contract

repo-tracked 基线入口固定为：

- split manifest:
  `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`
- retrieval qrels:
  `packages/evals/fixtures/official_web_fresh_news_retrieval_qrels.json`
- deterministic seed cases: `packages/evals/src/campus_evals/scenarios.py` ->
  `official_web_fresh_news_seed_validation_cases()`，仅作为 offline seed contract 保留

基线分母：

- `8` retrieval qrels cases for the current fresh-news handoff seed set
- `8` deterministic exact-title seed cases for future news opening work

## Accepted Baseline Snapshot

accepted baseline 目前固定采用 `2026-04-05` 这一轮 snapshot：

- effective seed documents：`8`
- cross-host duplicate skips：`3`
- validated physical collection：`official_web_fresh_news__r20260404_222909`
- retrieval baseline：
  - `total_cases = 8`
  - `hit_at_1 = 1.0`
  - `hit_at_3 = 1.0`
  - `recall_at_5 = 1.0`
  - `doc_hit_at_1 = 1.0`
  - `doc_recall_at_5 = 1.0`
  - `forbidden_hit_rate = 0.0`

## 基线解释

- 这组 baseline 只覆盖 handoff seed set 的 exact-title retrieval / answer path，不覆盖“今天
  / 最新 / 最近”这类 freshness-sensitive 问法
- `fresh_news` 在该基线下仍是 `offline_preparation` 语义，不应被写成默认 query-serving surface
- `fresh_news` 当前没有 corpus-specific Python live answer gate，也不是 eval-release
  dispatch profile
- cross-host duplicate 跳过说明 routed import 已具备基础去重能力，但不等于 `news_archive`
  或持续增量采集策略已经闭合
- 原始首次执行中关于 shared Postgres 饱和、临时 registry 路径等运行面细节，属于历史排障背景，不再保留在 active
  baseline
- 真正 opening 仍需按 `docs/reference/official-web-news-surface-opening-checklist.md`
  继续验证 opening gate

## 维护规则

- 这份文档只保存 seed denominator、关键数值和解释边界
- 新一轮 rerun 只在以下情况更新这里：
  - seed set 改变
  - qrels denominator 改变
  - accepted baseline verdict 改变
- 一次性 `.tmp` artifact、首次执行 workaround 和历史排障证据不再长期挂在本文

## 验证命令

- retrieval benchmark：
  - `uv run --all-packages python -m campus_evals.retrieval_benchmark
    --qrels packages/evals/fixtures/official_web_fresh_news_retrieval_qrels.json
    --results <run-results.json> --format json`
